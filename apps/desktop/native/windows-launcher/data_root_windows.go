//go:build windows

package main

import (
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const (
	appRegistryKey  = `Software\567Agent`
	dataRootRegName = "DataRoot"
	messageBoxOK    = 0x00000000
	messageBoxWarn  = 0x00000030
)

var user32MessageBox = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")

func showDataRootUnavailable(root string) {
	text, textErr := syscall.UTF16PtrFromString("567 Agent 数据目录当前不可用：\n" + root + "\n请连接该磁盘，或重新运行安装程序并将数据迁移到其他位置。")
	title, titleErr := syscall.UTF16PtrFromString("567 Agent")
	if textErr != nil || titleErr != nil {
		return
	}
	_, _, _ = user32MessageBox.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), messageBoxOK|messageBoxWarn)
}

func configuredDataRoot() string {
	keyName, err := syscall.UTF16PtrFromString(appRegistryKey)
	if err != nil {
		return ""
	}
	var key syscall.Handle
	if err := syscall.RegOpenKeyEx(syscall.HKEY_CURRENT_USER, keyName, 0, syscall.KEY_READ, &key); err != nil {
		return ""
	}
	defer syscall.RegCloseKey(key)

	valueName, err := syscall.UTF16PtrFromString(dataRootRegName)
	if err != nil {
		return ""
	}
	var valueType uint32
	var size uint32
	if err := syscall.RegQueryValueEx(key, valueName, nil, &valueType, nil, &size); err != nil || valueType != syscall.REG_SZ || size < 2 {
		return ""
	}
	buffer := make([]uint16, (size+1)/2)
	byteBuffer := (*byte)(unsafe.Pointer(&buffer[0]))
	if err := syscall.RegQueryValueEx(key, valueName, nil, &valueType, byteBuffer, &size); err != nil || valueType != syscall.REG_SZ {
		return ""
	}
	root := filepath.Clean(strings.TrimSpace(syscall.UTF16ToString(buffer)))
	if !filepath.IsAbs(root) || root == "." || root == string(filepath.Separator) || len(root) <= 3 {
		return ""
	}
	return root
}
