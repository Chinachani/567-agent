package main

import (
	"errors"
	"fmt"
	"os"

	"github.com/Chinachani/567-agent/apps/im-gateway/internal/hostproto"
	"github.com/Chinachani/567-agent/apps/im-gateway/internal/transport"
	"github.com/Chinachani/567-agent/apps/im-gateway/internal/transport/discord"
	"github.com/Chinachani/567-agent/apps/im-gateway/internal/transport/feishu"
	"github.com/Chinachani/567-agent/apps/im-gateway/internal/transport/imessage"
	signalcli "github.com/Chinachani/567-agent/apps/im-gateway/internal/transport/signal"
	"github.com/Chinachani/567-agent/apps/im-gateway/internal/transport/slack"
	"github.com/Chinachani/567-agent/apps/im-gateway/internal/transport/telegram"
	"github.com/Chinachani/567-agent/apps/im-gateway/internal/transport/wechat"
	"github.com/Chinachani/567-agent/apps/im-gateway/internal/transport/whatsapp"
)

// cleanupRemovedChannelState runs after the old transport has stopped. The
// desktop sends a fresh config snapshot after a channel is cleared, so a
// pairing session that disappeared from that snapshot must also disappear
// from the sidecar-owned state store.
func cleanupRemovedChannelState(previous, next *buildSpec, log func(level, msg string, fields map[string]any)) {
	if previous == nil || next == nil {
		return
	}
	if previous.Wechat != nil && (next.Wechat == nil || !next.Wechat.Enabled) {
		store, err := wechat.NewStateStoreForCLI(previous.WechatStatePath)
		if err == nil {
			err = store.Clear()
		}
		if err != nil && log != nil {
			log("error", "clear removed wechat session", map[string]any{"err": err.Error()})
		}
	}
	if previous.Whatsapp != nil && (next.Whatsapp == nil || !next.Whatsapp.Enabled) {
		if err := removeSQLiteState(previous.WhatsappStatePath); err != nil && log != nil {
			log("error", "clear removed whatsapp session", map[string]any{"err": err.Error()})
		}
	}
	if previous.Signal != nil && next.Signal == nil && previous.Signal.OwnsConfigDir && previous.Signal.ConfigDir != "" {
		if err := os.RemoveAll(previous.Signal.ConfigDir); err != nil && log != nil {
			log("error", "clear removed signal session", map[string]any{"err": err.Error()})
		}
	}
}

func removeSQLiteState(path string) error {
	if path == "" {
		return nil
	}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		err := os.Remove(path + suffix)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// hostChannel binds one InitFrame slot to its transport constructor.
//
// selected reports whether the parent asked for this channel; build turns
// the spec into a live transport. Adding a channel means adding a row to
// hostChannels — buildHostTransport itself never grows a branch.
type hostChannel struct {
	name     string
	selected func(*buildSpec) bool
	build    func(*buildSpec) (transport.Transport, error)
}

// hostChannels is the ordered channel table. The order keeps the active
// pairing channel first for bind-coordinator selection while all established
// channels are started by buildHostTransport.
var hostChannels = []hostChannel{
	{
		name:     "wechat",
		selected: func(s *buildSpec) bool { return s.Wechat != nil && s.Wechat.Enabled },
		build: func(s *buildSpec) (transport.Transport, error) {
			tr, err := wechat.New(wechat.Options{
				StatePath: s.WechatStatePath,
				InboxDir:  s.ConversationCwd,
			})
			if err != nil {
				if errors.Is(err, wechat.ErrNotBound) {
					return nil, errAwaitingBind
				}
				return nil, fmt.Errorf("build wechat transport: %w", err)
			}
			return tr, nil
		},
	},
	{
		name:     "feishu",
		selected: func(s *buildSpec) bool { return s.Feishu != nil },
		build: func(s *buildSpec) (transport.Transport, error) {
			// No credentials yet: park in awaiting_bind so the parent can
			// drive the one-click registration scan instead of failing.
			if s.Feishu.AppID == "" || s.Feishu.AppSecret == "" {
				return nil, errAwaitingBind
			}
			return feishu.New(feishu.Options{
				AppID:     s.Feishu.AppID,
				AppSecret: s.Feishu.AppSecret,
				Domain:    s.Feishu.BaseURL,
				InboxDir:  s.ConversationCwd,
			})
		},
	},
	{
		name:     "whatsapp",
		selected: func(s *buildSpec) bool { return s.Whatsapp != nil && s.Whatsapp.Enabled },
		build: func(s *buildSpec) (transport.Transport, error) {
			tr, err := whatsapp.New(whatsapp.Options{
				StatePath:      s.WhatsappStatePath,
				AllowedNumbers: s.Whatsapp.AllowedNumbers,
				InboxDir:       s.ConversationCwd,
			})
			if err != nil {
				return nil, fmt.Errorf("build whatsapp transport: %w", err)
			}
			if !tr.LoggedIn() {
				_ = tr.Stop()
				return nil, errAwaitingBind
			}
			return tr, nil
		},
	},
	{
		name:     "telegram",
		selected: func(s *buildSpec) bool { return s.Telegram != nil },
		build: func(s *buildSpec) (transport.Transport, error) {
			if s.Telegram.BotToken == "" {
				return nil, errors.New("telegram config missing botToken")
			}
			return telegram.New(telegram.Options{
				BotToken:       s.Telegram.BotToken,
				AllowedUserIDs: s.Telegram.AllowedUserIDs,
				InboxDir:       s.ConversationCwd,
			})
		},
	},
	{
		name:     "slack",
		selected: func(s *buildSpec) bool { return s.Slack != nil },
		build: func(s *buildSpec) (transport.Transport, error) {
			if s.Slack.BotToken == "" || s.Slack.AppToken == "" {
				return nil, errors.New("slack config missing botToken/appToken")
			}
			return slack.New(slack.Options{
				BotToken:          s.Slack.BotToken,
				AppToken:          s.Slack.AppToken,
				AllowedUserIDs:    s.Slack.AllowedUserIDs,
				AllowedChannelIDs: s.Slack.AllowedChannelIDs,
				InboxDir:          s.ConversationCwd,
			})
		},
	},
	{
		name:     "discord",
		selected: func(s *buildSpec) bool { return s.Discord != nil },
		build: func(s *buildSpec) (transport.Transport, error) {
			if s.Discord.BotToken == "" {
				return nil, errors.New("discord config missing botToken")
			}
			return discord.New(discord.Options{
				BotToken:        s.Discord.BotToken,
				AllowedUserIDs:  s.Discord.AllowedUserIDs,
				AllowedGuildIDs: s.Discord.AllowedGuildIDs,
				InboxDir:        s.ConversationCwd,
			})
		},
	},
	{
		name:     "signal",
		selected: func(s *buildSpec) bool { return s.Signal != nil },
		build: func(s *buildSpec) (transport.Transport, error) {
			// Managed mode discovers the account from signal-cli and lets
			// the transport own the daemon; awaiting_bind comes back when
			// no device is linked yet. See resolveSignalAccount.
			account, err := resolveSignalAccount(s.Signal)
			if err != nil {
				return nil, err
			}
			opts := signalcli.Options{
				Account:        account,
				AllowedNumbers: s.Signal.AllowedNumbers,
				AttachmentsDir: s.Signal.AttachmentsDir,
				InboxDir:       s.ConversationCwd,
			}
			if signalManaged(s.Signal) {
				opts.Managed = &signalcli.ManagedOptions{
					CLI: signalCLIOptions(s.Signal),
					Log: s.Log,
				}
			} else {
				opts.Endpoint = s.Signal.Endpoint
			}
			return signalcli.New(opts)
		},
	},
	{
		name:     "imessage",
		selected: func(s *buildSpec) bool { return s.IMessage != nil && s.IMessage.Enabled },
		build: func(s *buildSpec) (transport.Transport, error) {
			return imessage.New(imessage.Options{
				DBPath:         s.IMessage.DBPath,
				AllowedHandles: s.IMessage.AllowedHandles,
				InboxDir:       s.ConversationCwd,
			})
		},
	},
}

// buildHostTransport constructs the IM transport from the supplied build
// spec by consulting hostChannels in order.
//
// Returns errAwaitingBind when a pairing-based channel is selected but no
// credentials have been persisted yet — the host runtime catches this and
// parks the sidecar in awaiting_bind mode instead of failing init.
func buildHostTransport(spec *buildSpec) (transport.Transport, error) {
	if spec == nil {
		return nil, errors.New("build spec missing")
	}
	var transports []transport.Transport
	var selected, awaitingActive bool
	reportStatus := func(channel, status string) {
		if spec.ReportChannelStatus != nil {
			spec.ReportChannelStatus(channel, status)
		}
	}
	for _, ch := range hostChannels {
		if !ch.selected(spec) {
			continue
		}
		selected = true
		tr, err := ch.build(spec)
		switch {
		case errors.Is(err, errAwaitingBind):
			reportStatus(ch.name, hostproto.TransportStatusAwaitingBind)
			awaitingActive = awaitingActive || spec.ActiveTransport == ch.name
		case err != nil:
			if spec.ActiveTransport == "" {
				return nil, err
			}
			reportStatus(ch.name, hostproto.TransportStatusError)
			if spec.Log != nil {
				spec.Log("error", "Claw channel setup failed", map[string]any{"transport": ch.name, "err": err.Error()})
			}
		default:
			transports = append(transports, tr)
		}
	}
	if spec.ActiveTransport != "" && (selected || spec.hasChannel()) {
		// Keep chat identities scoped with one channel too. A broken channel
		// must not tear down the other receiving loops or the pairing flow.
		multi := newMultiTransport(transports, spec.Log)
		multi.reportStatus = spec.ReportChannelStatus
		multi.awaitingActive = awaitingActive
		multi.keepAlive = true
		return multi, nil
	}
	if len(transports) == 1 {
		return transports[0], nil
	}
	if len(transports) > 1 {
		return newMultiTransport(transports, spec.Log), nil
	}
	if spec.hasChannel() {
		return nil, errAwaitingBind
	}
	return nil, errors.New("build spec selects no transport")
}
