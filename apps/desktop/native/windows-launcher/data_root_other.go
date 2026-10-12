//go:build !windows

package main

func configuredDataRoot() string     { return "" }
func showDataRootUnavailable(string) {}
