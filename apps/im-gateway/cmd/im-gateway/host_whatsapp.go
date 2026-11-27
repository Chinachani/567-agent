package main

import (
	"context"
	"errors"
	"sync"

	"github.com/Chinachani/567-agent/apps/im-gateway/internal/hostproto"
	"github.com/Chinachani/567-agent/apps/im-gateway/internal/transport"
	"github.com/Chinachani/567-agent/apps/im-gateway/internal/transport/whatsapp"
)

// whatsappBindCoordinator owns the QR pairing flow for an app-managed
// whatsmeow session. The transport is created only for the pairing operation
// while the host is awaiting_bind, then rebuilt by the host after success.
type whatsappBindCoordinator struct {
	statePath string
	out       *hostproto.Writer
	emitLog   func(level, msg string, fields map[string]any)
	rebuildCh chan<- struct{}

	mu     sync.Mutex
	cancel context.CancelFunc
}

var _ bindCoordinator = (*whatsappBindCoordinator)(nil)

func newWhatsappBindCoordinator(
	statePath string,
	out *hostproto.Writer,
	emitLog func(level, msg string, fields map[string]any),
	rebuildCh chan<- struct{},
) *whatsappBindCoordinator {
	return &whatsappBindCoordinator{
		statePath: statePath,
		out:       out,
		emitLog:   emitLog,
		rebuildCh: rebuildCh,
	}
}

func (c *whatsappBindCoordinator) Adopt(spec *buildSpec) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.statePath = spec.WhatsappStatePath
}

func (c *whatsappBindCoordinator) Start(ctx context.Context) {
	c.mu.Lock()
	if c.cancel != nil {
		c.mu.Unlock()
		c.emitLog("info", "whatsapp bind already in progress, ignoring duplicate start", nil)
		return
	}
	bindCtx, cancel := context.WithCancel(ctx)
	c.cancel = cancel
	statePath := c.statePath
	c.mu.Unlock()
	go c.run(bindCtx, statePath)
}

func (c *whatsappBindCoordinator) Cancel() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
}

func (c *whatsappBindCoordinator) run(ctx context.Context, statePath string) {
	defer func() {
		c.mu.Lock()
		c.cancel = nil
		c.mu.Unlock()
	}()

	tr, err := whatsapp.New(whatsapp.Options{StatePath: statePath})
	if err != nil {
		c.emitFailure(err)
		return
	}
	defer func() { _ = tr.Stop() }()

	c.emitLog("info", "whatsapp bind: generating QR", nil)
	events, err := tr.PairQR(ctx)
	if err != nil {
		if errors.Is(err, context.Canceled) || ctx.Err() != nil {
			c.emitCancelled()
		} else {
			c.emitFailure(err)
		}
		return
	}
	attempt := 0
	for event := range events {
		switch {
		case event.QRCode != "":
			attempt++
			_ = c.out.WriteFrame(hostproto.WhatsappQREvent{
				Type:    hostproto.TypeWhatsappQR,
				Code:    event.QRCode,
				Attempt: attempt,
			})
		case event.Done:
			// Close the pairing store before the main loop rebuilds the live
			// transport from the same SQLite file.
			_ = tr.Stop()
			_ = c.out.WriteFrame(hostproto.WhatsappBindStatusEvent{
				Type:   hostproto.TypeWhatsappBindStatus,
				Status: hostproto.WechatBindStatusConfirmed,
			})
			_ = c.out.WriteFrame(hostproto.WhatsappBoundEvent{
				Type: hostproto.TypeWhatsappBound,
				JID:  tr.AccountJID(),
			})
			select {
			case c.rebuildCh <- struct{}{}:
			default:
			}
			return
		case event.Err != nil:
			if errors.Is(event.Err, context.Canceled) || ctx.Err() != nil {
				c.emitCancelled()
			} else {
				c.emitFailure(event.Err)
			}
			return
		}
	}
	if ctx.Err() != nil {
		c.emitCancelled()
		return
	}
	c.emitFailure(errors.New("whatsapp bind ended before pairing completed"))
}

func (c *whatsappBindCoordinator) emitCancelled() {
	_ = c.out.WriteFrame(hostproto.WhatsappBindStatusEvent{
		Type:   hostproto.TypeWhatsappBindStatus,
		Status: hostproto.WechatBindStatusCancelled,
	})
}

func (c *whatsappBindCoordinator) emitUnbound(reason string) {
	c.Cancel()
	_ = c.out.WriteFrame(hostproto.WhatsappUnboundEvent{
		Type:   hostproto.TypeWhatsappUnbound,
		Reason: reason,
	})
}

func (c *whatsappBindCoordinator) emitFailure(err error) {
	c.emitLog("error", "whatsapp bind failed", map[string]any{"err": err.Error()})
	_ = c.out.WriteFrame(hostproto.WhatsappBindStatusEvent{
		Type:   hostproto.TypeWhatsappBindStatus,
		Status: hostproto.WechatBindStatusFailed,
		Error:  err.Error(),
	})
}

// LogoutAndClear removes the app-owned WhatsApp session. The current host
// rebuilds the transport immediately after this call, so the next build
// enters awaiting_bind and the parent can start a fresh pairing.
func (c *whatsappBindCoordinator) LogoutAndClear(reason string) error {
	c.Cancel()
	c.mu.Lock()
	statePath := c.statePath
	c.mu.Unlock()
	tr, err := whatsapp.New(whatsapp.Options{StatePath: statePath})
	if err != nil {
		return err
	}
	defer func() { _ = tr.Stop() }()
	if tr.LoggedIn() {
		if err := tr.Logout(context.Background()); err != nil {
			return err
		}
	}
	c.emitUnbound(reason)
	return nil
}

func logoutActiveWhatsapp(current transport.Transport) (bool, error) {
	if whatsappTransport, ok := current.(*whatsapp.Transport); ok {
		if whatsappTransport.Stopped() {
			return false, nil
		}
		return true, whatsappTransport.Logout(context.Background())
	}
	if multi, ok := current.(*multiTransport); ok {
		whatsappTransport, ok := multi.byName["whatsapp"].(*whatsapp.Transport)
		if !ok {
			return false, nil
		}
		if whatsappTransport.Stopped() {
			return false, nil
		}
		return true, whatsappTransport.Logout(context.Background())
	}
	return false, nil
}

func stopActiveWhatsapp(current transport.Transport) bool {
	if whatsappTransport, ok := current.(*whatsapp.Transport); ok {
		_ = whatsappTransport.Stop()
		return true
	}
	if multi, ok := current.(*multiTransport); ok {
		whatsappTransport, ok := multi.byName["whatsapp"].(*whatsapp.Transport)
		if !ok {
			return false
		}
		_ = whatsappTransport.Stop()
		return true
	}
	return false
}
