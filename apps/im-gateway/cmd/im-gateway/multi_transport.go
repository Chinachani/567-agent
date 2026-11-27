package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/Chinachani/567-agent/apps/im-gateway/internal/hostproto"
	"github.com/Chinachani/567-agent/apps/im-gateway/internal/transport"
)

const channelChatPrefix = "im-channel/"

// multiTransport scopes chat IDs before the router can enqueue or persist them.
// Message IDs remain native because a turn binds directly to its own transport.
type multiTransport struct {
	transports     []transport.Transport
	byName         map[string]transport.Transport
	log            func(level, message string, fields map[string]any)
	reportStatus   func(channel, status string)
	onError        func(ctx context.Context, channel string, err error)
	awaitingActive bool
	keepAlive      bool
}

func newMultiTransport(transports []transport.Transport, log func(string, string, map[string]any)) *multiTransport {
	byName := make(map[string]transport.Transport, len(transports))
	for _, current := range transports {
		byName[current.Name()] = current
	}
	return &multiTransport{transports: transports, byName: byName, log: log}
}

func (m *multiTransport) Name() string {
	if len(m.transports) == 1 {
		return m.transports[0].Name()
	}
	return "multi"
}

func (*multiTransport) Capabilities() transport.Capabilities { return transport.Capabilities{} }

func (m *multiTransport) ResolveChat(chatID string) (transport.Transport, string, error) {
	key, scoped := strings.CutPrefix(chatID, channelChatPrefix)
	channel, nativeID, valid := strings.Cut(key, "/")
	if current := m.byName[channel]; scoped && valid && current != nil && nativeID != "" {
		return current, nativeID, nil
	}
	return nil, "", errors.New("requested Claw chat channel is unavailable")
}

func (m *multiTransport) Start(ctx context.Context, handler transport.MessageHandler) error {
	var wg sync.WaitGroup
	errorsCh := make(chan error, len(m.transports))
	for _, current := range m.transports {
		wg.Add(1)
		go func() {
			defer wg.Done()
			channel := current.Name()
			runCtx, cancel := context.WithCancel(ctx)
			defer cancel()
			if m.reportStatus != nil {
				m.reportStatus(channel, hostproto.TransportStatusConnecting)
				runCtx = transport.ObserveConnection(runCtx, func(status transport.ConnectionState) {
					m.reportStatus(channel, string(status))
				})
			}
			err := current.Start(runCtx, transport.MessageHandlerFunc(func(ctx context.Context, msg transport.InboundMessage) error {
				msg.ChatID = channelChatPrefix + current.Name() + "/" + msg.ChatID
				return handler.HandleInbound(ctx, msg)
			}))
			cancel()
			if ctx.Err() != nil {
				return
			}
			if err != nil && !errors.Is(err, context.Canceled) {
				if m.reportStatus != nil {
					m.reportStatus(channel, hostproto.TransportStatusError)
				}
				if m.onError != nil {
					m.onError(ctx, channel, err)
				}
				if m.log != nil {
					m.log("error", "Claw channel stopped", map[string]any{"transport": current.Name(), "err": err.Error()})
				}
				errorsCh <- fmt.Errorf("%s: %w", channel, err)
			} else if m.reportStatus != nil {
				m.reportStatus(channel, hostproto.TransportStatusOffline)
			}
		}()
	}
	wg.Wait()
	close(errorsCh)
	// Keep pairing and diagnostics available even if all channel loops stop.
	if m.keepAlive {
		<-ctx.Done()
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return <-errorsCh
}

func (m *multiTransport) Stop() error {
	var firstErr error
	for _, current := range m.transports {
		if err := current.Stop(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (m *multiTransport) SendMessage(ctx context.Context, chatID string, msg transport.OutboundMessage) (string, error) {
	current, nativeID, err := m.ResolveChat(chatID)
	if err != nil {
		return "", err
	}
	return current.SendMessage(ctx, nativeID, msg)
}

func (m *multiTransport) EditMessage(ctx context.Context, chatID, messageID string, msg transport.OutboundMessage) error {
	current, nativeID, err := m.ResolveChat(chatID)
	if err != nil {
		return err
	}
	return current.EditMessage(ctx, nativeID, messageID, msg)
}

func (m *multiTransport) EndStream(ctx context.Context, chatID, messageID string) error {
	current, nativeID, err := m.ResolveChat(chatID)
	if err != nil {
		return err
	}
	return current.EndStream(ctx, nativeID, messageID)
}

func (m *multiTransport) DeleteMessage(ctx context.Context, chatID, messageID string) error {
	current, nativeID, err := m.ResolveChat(chatID)
	if err != nil {
		return err
	}
	return current.DeleteMessage(ctx, nativeID, messageID)
}

func (m *multiTransport) ShowTyping(ctx context.Context, chatID string) error {
	current, nativeID, err := m.ResolveChat(chatID)
	if err != nil {
		return err
	}
	return current.ShowTyping(ctx, nativeID)
}

func (m *multiTransport) SendAttachment(ctx context.Context, chatID string, attachment transport.OutboundAttachment) (string, error) {
	current, nativeID, err := m.ResolveChat(chatID)
	if err != nil {
		return "", err
	}
	return current.SendAttachment(ctx, nativeID, attachment)
}

var _ transport.ChatResolver = (*multiTransport)(nil)
