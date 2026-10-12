package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeExecutable(t *testing.T, root string, version string) string {
	t.Helper()
	target := executableForVersion(root, version)
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("exe"), 0o755); err != nil {
		t.Fatal(err)
	}
	return target
}

func TestResolveDataLayoutUsesSelectedRoot(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Data")
	dataRoot, updateStore, updaterCache := resolveDataLayout(root, "C:/Users/test/AppData/Local")
	if dataRoot != root || updateStore != filepath.Join(root, "windows-updates") || updaterCache != filepath.Join(root, "updater-cache") {
		t.Fatalf("unexpected selected data layout: %q %q %q", dataRoot, updateStore, updaterCache)
	}
}

func TestResolveDataLayoutKeepsLegacyLocationsWithoutSelection(t *testing.T) {
	localAppData := filepath.Join(t.TempDir(), "AppData", "Local")
	dataRoot, updateStore, updaterCache := resolveDataLayout("", localAppData)
	if dataRoot != "" || updateStore != filepath.Join(localAppData, "567Agent") || updaterCache != filepath.Join(localAppData, "567-agent-updater") {
		t.Fatalf("unexpected fallback layout: %q %q %q", dataRoot, updateStore, updaterCache)
	}
}

func TestEnvironmentWithAgent567PathsReplacesOldValues(t *testing.T) {
	root := filepath.Join(t.TempDir(), "567 Data")
	environment := environmentWithAgent567Paths([]string{
		"PATH=C:/Windows",
		"AGENT567_HOME=C:/old",
		"AGENT567_WINDOWS_DATA_ROOT=C:/old",
		"agent567_desktop_user_data_dir=C:/old/profile",
	}, root)
	want := []string{
		"PATH=C:/Windows",
		"AGENT567_HOME=" + root,
		"AGENT567_WINDOWS_DATA_ROOT=" + root,
		"AGENT567_DESKTOP_USER_DATA_DIR=" + filepath.Join(root, "electron-user-data"),
		"AGENT567_WINDOWS_UPDATE_STORE=" + filepath.Join(root, "windows-updates"),
		"AGENT567_UPDATER_CACHE_DIR=" + filepath.Join(root, "updater-cache"),
	}
	if len(environment) != len(want) {
		t.Fatalf("got environment %#v", environment)
	}
	for _, expected := range want {
		found := false
		for _, actual := range environment {
			if actual == expected {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("missing %q in %#v", expected, environment)
		}
	}
}

func TestEnvironmentWithAgent567PathsRemovesUnregisteredOverrides(t *testing.T) {
	environment := environmentWithAgent567Paths([]string{
		"PATH=C:/Windows",
		"AGENT567_WINDOWS_DATA_ROOT=D:/stale",
		"AGENT567_WINDOWS_UPDATE_STORE=D:/stale/windows-updates",
	}, "")
	if len(environment) != 1 || environment[0] != "PATH=C:/Windows" {
		t.Fatalf("unexpected environment %#v", environment)
	}
}

func TestResolveLaunchTargetUsesActiveLocalVersion(t *testing.T) {
	installRoot := t.TempDir()
	localRoot := t.TempDir()
	writeExecutable(t, installRoot, "1.0.0")
	localTarget := writeExecutable(t, localRoot, "1.1.0")
	writePointer(filepath.Join(installRoot, "current.json"), versionPointer{Version: "1.0.0"})
	writePointer(filepath.Join(localRoot, "current.json"), versionPointer{Version: "1.1.0"})

	if target := resolveLaunchTarget(installRoot, localRoot); target != localTarget {
		t.Fatalf("expected %s, got %s", localTarget, target)
	}
}

func TestResolveLaunchTargetRollsBackPendingVersion(t *testing.T) {
	installRoot := t.TempDir()
	localRoot := t.TempDir()
	writeExecutable(t, installRoot, "1.0.0")
	previousTarget := writeExecutable(t, localRoot, "1.1.0")
	writeExecutable(t, localRoot, "1.2.0")
	writePointer(filepath.Join(installRoot, "current.json"), versionPointer{Version: "1.0.0"})
	writePointer(filepath.Join(localRoot, "current.json"), versionPointer{
		Version:         "1.2.0",
		PreviousVersion: "1.1.0",
		Pending:         true,
	})

	if target := resolveLaunchTarget(installRoot, localRoot); target != previousTarget {
		t.Fatalf("expected %s, got %s", previousTarget, target)
	}
}

func TestResolveLaunchTargetFallsBackToBundledVersion(t *testing.T) {
	installRoot := t.TempDir()
	localRoot := t.TempDir()
	bundledTarget := writeExecutable(t, installRoot, "1.0.0")
	writePointer(filepath.Join(installRoot, "current.json"), versionPointer{Version: "1.0.0"})
	writePointer(filepath.Join(localRoot, "current.json"), versionPointer{
		Version:         "1.1.0",
		PreviousVersion: "1.0.0",
		Pending:         true,
	})

	if target := resolveLaunchTarget(installRoot, localRoot); target != bundledTarget {
		t.Fatalf("expected %s, got %s", bundledTarget, target)
	}
}
