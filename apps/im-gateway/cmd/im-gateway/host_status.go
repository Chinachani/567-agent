package main

import (
	"sync"
	"time"

	"github.com/Chinachani/567-agent/apps/im-gateway/internal/hostproto"
)

// hostStatus publishes complete snapshots and rejects updates from a
// transport that was replaced during a bind or a configuration change.
type hostStatus struct {
	mu         sync.Mutex
	out        *hostproto.Writer
	generation uint64
	status     string
	lastError  string
	channels   map[string]string
}

func (s *hostStatus) begin() func(channel, status string) {
	s.mu.Lock()
	s.generation++
	generation := s.generation
	s.channels = make(map[string]string)
	s.status, s.lastError = hostproto.TransportStatusConnecting, ""
	s.writeLocked()
	s.mu.Unlock()
	return func(channel, status string) {
		s.mu.Lock()
		defer s.mu.Unlock()
		if generation != s.generation || s.channels[channel] == status {
			return
		}
		s.channels[channel] = status
		s.writeLocked()
	}
}

func (s *hostStatus) set(status, lastError string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status, s.lastError = status, lastError
	s.writeLocked()
}

func (s *hostStatus) writeLocked() {
	_ = s.out.WriteFrame(hostproto.StatusEvent{
		Type: hostproto.TypeStatus, Transport: s.status, LastError: s.lastError,
		ChannelStatuses: &s.channels, Time: time.Now().UTC(),
	})
}
