package main

import (
	"context"
	"testing"

	"github.com/Chinachani/567-agent/apps/im-gateway/internal/transport"
)

type recordingTransport struct {
	name    string
	handler transport.MessageHandler
	sends   []string
}

func (r *recordingTransport) Name() string { return r.name }
func (r *recordingTransport) Capabilities() transport.Capabilities {
	return transport.Capabilities{SupportsMessageEdit: r.name == "first", DeferUntilTurnEnd: r.name == "second"}
}
func (r *recordingTransport) Start(_ context.Context, handler transport.MessageHandler) error {
	r.handler = handler
	return nil
}
func (r *recordingTransport) Stop() error { return nil }
func (r *recordingTransport) SendMessage(_ context.Context, chatID string, _ transport.OutboundMessage) (string, error) {
	r.sends = append(r.sends, "send:"+chatID)
	return "same-message", nil
}
func (r *recordingTransport) EditMessage(_ context.Context, chatID, messageID string, _ transport.OutboundMessage) error {
	r.sends = append(r.sends, "edit:"+chatID+":"+messageID)
	return nil
}
func (r *recordingTransport) EndStream(context.Context, string, string) error     { return nil }
func (r *recordingTransport) DeleteMessage(context.Context, string, string) error { return nil }
func (r *recordingTransport) ShowTyping(context.Context, string) error            { return nil }
func (r *recordingTransport) SendAttachment(context.Context, string, transport.OutboundAttachment) (string, error) {
	return r.name + "-attachment", nil
}

func TestMultiTransportSeparatesIdenticalChatAndMessageIDs(t *testing.T) {
	first := &recordingTransport{name: "first"}
	second := &recordingTransport{name: "second"}
	multi := newMultiTransport([]transport.Transport{first, second}, nil)
	ctx := context.Background()
	inbound := make(chan transport.InboundMessage, 2)
	if err := multi.Start(ctx, transport.MessageHandlerFunc(func(_ context.Context, msg transport.InboundMessage) error {
		inbound <- msg
		return nil
	})); err != nil {
		t.Fatal(err)
	}

	message := transport.InboundMessage{UserID: "same-user", ChatID: "same/chat", MessageID: "same-message"}
	for _, channel := range []*recordingTransport{first, second} {
		if err := channel.handler.HandleInbound(ctx, message); err != nil {
			t.Fatal(err)
		}
	}
	fromFirst, fromSecond := <-inbound, <-inbound
	if fromFirst.ChatID == fromSecond.ChatID || fromFirst.MessageID != message.MessageID || fromSecond.MessageID != message.MessageID {
		t.Fatalf("unexpected routing IDs: %+v and %+v", fromFirst, fromSecond)
	}
	for _, incoming := range []transport.InboundMessage{fromFirst, fromSecond} {
		id, err := multi.SendMessage(ctx, incoming.ChatID, transport.OutboundMessage{Text: "reply"})
		if err != nil || id != message.MessageID {
			t.Fatalf("reply id = %q, %v", id, err)
		}
	}
	firstChannel, nativeID, err := multi.ResolveChat(fromFirst.ChatID)
	if err != nil || firstChannel != first || nativeID != message.ChatID || !firstChannel.Capabilities().SupportsMessageEdit {
		t.Fatalf("first turn route = %v, %q, %v", firstChannel, nativeID, err)
	}
	secondChannel, _, err := multi.ResolveChat(fromSecond.ChatID)
	if err != nil || secondChannel != second || !secondChannel.Capabilities().DeferUntilTurnEnd {
		t.Fatalf("second turn route = %v, %v", secondChannel, err)
	}
	if err := multi.EditMessage(ctx, fromFirst.ChatID, message.MessageID, transport.OutboundMessage{Text: "edit"}); err != nil {
		t.Fatal(err)
	}
	if len(first.sends) != 2 || first.sends[1] != "edit:same/chat:same-message" || len(second.sends) != 1 || second.sends[0] != "send:same/chat" {
		t.Fatalf("unexpected sends first=%v second=%v", first.sends, second.sends)
	}

	firstOnly := newMultiTransport([]transport.Transport{first}, nil)
	if route, _, err := firstOnly.ResolveChat(fromFirst.ChatID); err != nil || route != first {
		t.Fatalf("first chat stopped routing after removing second channel: %v, %v", route, err)
	}
	if _, err := firstOnly.SendMessage(ctx, fromSecond.ChatID, transport.OutboundMessage{}); err == nil {
		t.Fatal("a removed channel must not fall back to a different channel")
	}
}
