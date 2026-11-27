package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/Chinachani/567-agent/apps/im-gateway/internal/hostproto"
	"github.com/Chinachani/567-agent/apps/im-gateway/internal/transport"
)

func TestHostStatusReplacesSnapshotAndRejectsRetiredRun(t *testing.T) {
	var output bytes.Buffer
	status := hostStatus{out: hostproto.NewWriter(&output)}
	previous := status.begin()
	previous("wechat", "online")
	previous("telegram", "online")
	current := status.begin()
	previous("wechat", "online")
	current("telegram", "online")

	scanner := bufio.NewScanner(&output)
	var snapshots []hostproto.StatusEvent
	for scanner.Scan() {
		var event hostproto.StatusEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatal(err)
		}
		snapshots = append(snapshots, event)
	}
	if len(snapshots) != 5 {
		t.Fatalf("expected five snapshots, got %d: %s", len(snapshots), output.String())
	}
	if channels := *snapshots[2].ChannelStatuses; channels["wechat"] != "online" || channels["telegram"] != "online" {
		t.Fatalf("two channels online: %v", channels)
	}
	if channels := snapshots[3].ChannelStatuses; channels == nil || len(*channels) != 0 {
		t.Fatalf("new run must publish an explicit empty snapshot: %+v", channels)
	}
	if channels := *snapshots[4].ChannelStatuses; len(channels) != 1 || channels["telegram"] != "online" {
		t.Fatalf("retired channel resurfaced: %v", channels)
	}
}

type statusTransport struct {
	recordingTransport
	start func(context.Context) error
}

func (t *statusTransport) Start(ctx context.Context, _ transport.MessageHandler) error {
	return t.start(ctx)
}

func TestMultiTransportPublishesIndependentReadinessAndFailure(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	ready := make(chan struct{})
	multi := newMultiTransport([]transport.Transport{
		&statusTransport{recordingTransport: recordingTransport{name: "telegram"}, start: func(ctx context.Context) error {
			<-ready
			transport.ReportConnection(ctx, transport.ConnectionOnline)
			<-ctx.Done()
			return ctx.Err()
		}},
		&statusTransport{recordingTransport: recordingTransport{name: "slack"}, start: func(context.Context) error {
			return errors.New("test channel failure")
		}},
	}, nil)
	updates := make(chan [2]string, 8)
	multi.reportStatus = func(channel, status string) { updates <- [2]string{channel, status} }
	done := make(chan error, 1)
	go func() { done <- multi.Start(ctx, nil) }()
	states := make(map[string]string)
	for states["telegram"] != "connecting" || states["slack"] != "error" {
		select {
		case update := <-updates:
			states[update[0]] = update[1]
		case <-ctx.Done():
			t.Fatalf("expected independent starting and failure states: %v", states)
		}
	}
	close(ready)
	select {
	case update := <-updates:
		if update != [2]string{"telegram", "online"} {
			t.Fatalf("channel never reported ready: %v", update)
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for channel readiness")
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("unexpected shutdown error: %v", err)
	}
}
