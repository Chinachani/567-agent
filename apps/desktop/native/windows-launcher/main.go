package main

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

const executableName = "567-Agent.exe"

var versionPattern = regexp.MustCompile(`^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$`)

type versionPointer struct {
	Version         string `json:"version"`
	PreviousVersion string `json:"previousVersion,omitempty"`
	Pending         bool   `json:"pending,omitempty"`
}

func isValidVersion(version string) bool {
	return version != "." && version != ".." && versionPattern.MatchString(version)
}

func readPointer(path string) (versionPointer, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return versionPointer{}, err
	}
	var pointer versionPointer
	if err := json.Unmarshal(data, &pointer); err != nil {
		return versionPointer{}, err
	}
	if !isValidVersion(pointer.Version) {
		return versionPointer{}, errors.New("invalid version pointer")
	}
	if pointer.PreviousVersion != "" && !isValidVersion(pointer.PreviousVersion) {
		return versionPointer{}, errors.New("invalid previous version pointer")
	}
	return pointer, nil
}

func executableForVersion(root string, version string) string {
	return filepath.Join(root, "versions", version, executableName)
}

func existingExecutable(root string, version string) string {
	if !isValidVersion(version) {
		return ""
	}
	target := executableForVersion(root, version)
	info, err := os.Stat(target)
	if err != nil || info.IsDir() {
		return ""
	}
	return target
}

func writePointer(path string, pointer versionPointer) {
	data, err := json.Marshal(pointer)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, append(data, '\n'), 0o644)
}

func resolveLaunchTarget(installRoot string, localRoot string) string {
	localPointerPath := filepath.Join(localRoot, "current.json")
	if pointer, err := readPointer(localPointerPath); err == nil {
		if pointer.Pending {
			if previous := existingExecutable(localRoot, pointer.PreviousVersion); previous != "" {
				writePointer(localPointerPath, versionPointer{Version: pointer.PreviousVersion})
				return previous
			}
			_ = os.Remove(localPointerPath)
		} else if target := existingExecutable(localRoot, pointer.Version); target != "" {
			return target
		}
	}

	bundledPointer, err := readPointer(filepath.Join(installRoot, "current.json"))
	if err != nil {
		return ""
	}
	return existingExecutable(installRoot, bundledPointer.Version)
}

func startDetached(target string, args []string) error {
	command := exec.Command(target, args...)
	command.Dir = filepath.Dir(target)
	command.Env = environmentWithAgent567Paths(os.Environ(), configuredDataRoot())
	// Do NOT set HideWindow / STARTF_USESHOWWINDOW+SW_HIDE.
	// That overrides the child GUI process's first ShowWindow and leaves the
	// Electron main window with WS_VISIBLE cleared (tray-only, no UI).
	// Launcher itself is built with -H=windowsgui so no console flashes.
	if err := command.Start(); err != nil {
		return err
	}
	return command.Process.Release()
}

func resolveDataLayout(configuredRoot string, localAppData string) (dataRoot string, updateStore string, updaterCache string) {
	dataRoot = filepath.Clean(configuredRoot)
	if configuredRoot == "" {
		dataRoot = ""
	}
	if dataRoot != "" {
		return dataRoot, filepath.Join(dataRoot, "windows-updates"), filepath.Join(dataRoot, "updater-cache")
	}
	legacyRoot := filepath.Join(localAppData, "567Agent")
	return "", legacyRoot, filepath.Join(localAppData, "567-agent-updater")
}

func environmentWithAgent567Paths(environment []string, configuredRoot string) []string {
	managed := map[string]bool{
		"AGENT567_HOME":                  true,
		"AGENT567_WINDOWS_DATA_ROOT":     true,
		"AGENT567_DESKTOP_USER_DATA_DIR": true,
		"AGENT567_WINDOWS_UPDATE_STORE":  true,
		"AGENT567_UPDATER_CACHE_DIR":     true,
	}
	values := map[string]string{}
	if configuredRoot != "" {
		dataRoot, updateStore, updaterCache := resolveDataLayout(configuredRoot, "")
		values = map[string]string{
			"AGENT567_HOME":                  dataRoot,
			"AGENT567_WINDOWS_DATA_ROOT":     dataRoot,
			"AGENT567_DESKTOP_USER_DATA_DIR": filepath.Join(dataRoot, "electron-user-data"),
			"AGENT567_WINDOWS_UPDATE_STORE":  updateStore,
			"AGENT567_UPDATER_CACHE_DIR":     updaterCache,
		}
	}
	result := make([]string, 0, len(environment)+len(values))
	for _, entry := range environment {
		separator := strings.IndexByte(entry, '=')
		if separator < 0 {
			result = append(result, entry)
			continue
		}
		name := strings.ToUpper(entry[:separator])
		if !managed[name] {
			result = append(result, entry)
		}
	}
	for name, value := range values {
		result = append(result, name+"="+value)
	}
	return result
}

func main() {
	launcherPath, err := os.Executable()
	if err != nil {
		return
	}
	localAppData, err := os.UserCacheDir()
	if err != nil {
		return
	}
	installRoot := filepath.Dir(launcherPath)
	configuredRoot := configuredDataRoot()
	if configuredRoot != "" {
		info, statErr := os.Stat(configuredRoot)
		if statErr != nil || !info.IsDir() {
			showDataRootUnavailable(configuredRoot)
			return
		}
	}
	_, localRoot, _ := resolveDataLayout(configuredRoot, localAppData)
	target := resolveLaunchTarget(installRoot, localRoot)
	if target == "" {
		return
	}
	_ = startDetached(target, os.Args[1:])
}
