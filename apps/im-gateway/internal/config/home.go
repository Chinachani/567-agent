package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	defaultConfigDirName = ".567agent"
	legacyConfigDirName  = ".vetta"
)

// configHome resolves the same per-user data directory as the desktop app.
// On first launch it moves the legacy home as a unit so credentials, state,
// logs, and gateway settings keep their relative paths.
func configHome() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("AGENT567_HOME")); configured != "" {
		return expandHomePath(configured)
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home dir: %w", err)
	}
	name := strings.TrimSpace(os.Getenv("AGENT567_CONFIG_DIR"))
	if name == "" {
		name = defaultConfigDirName
	}
	configured, err := expandHomePath(name)
	if err != nil {
		return "", err
	}
	if !filepath.IsAbs(configured) {
		configured = filepath.Join(home, configured)
	}

	if name == defaultConfigDirName {
		legacy := filepath.Join(home, legacyConfigDirName)
		if _, err := os.Stat(configured); os.IsNotExist(err) {
			if _, legacyErr := os.Stat(legacy); legacyErr == nil {
				if err := os.Rename(legacy, configured); err != nil {
					return "", fmt.Errorf("migrate legacy config directory %s to %s: %w", legacy, configured, err)
				}
			}
		}
	}
	return configured, nil
}

func expandHomePath(path string) (string, error) {
	if path == "~" || strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home dir: %w", err)
		}
		if path == "~" {
			return home, nil
		}
		return filepath.Join(home, path[2:]), nil
	}
	return filepath.Clean(path), nil
}
