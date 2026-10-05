// Copyright (C) 2025 veypi <i@veypi.com>
// Distributed under terms of the MIT license.

// A standalone native CLI example. Skills do not register or launch it.
package main

import (
	"fmt"
	"io"
	"os"
	"strconv"
	"time"
)

func main() {
	args := os.Args[1:]
	if len(args) == 0 {
		fmt.Println("hello from aic skill")
		return
	}
	switch args[0] {
	case "argv":
		for _, a := range args[1:] {
			fmt.Println(a)
		}
	case "cwd":
		wd, err := os.Getwd()
		if err != nil {
			fmt.Fprintln(os.Stderr, "cwd:", err)
			os.Exit(1)
		}
		fmt.Println(wd)
	case "pipe":
		if _, err := io.Copy(os.Stdout, os.Stdin); err != nil {
			fmt.Fprintln(os.Stderr, "pipe:", err)
			os.Exit(1)
		}
	case "probe-write":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "usage: hello-process probe-write <path>")
			os.Exit(2)
		}
		err := os.WriteFile(args[1], []byte("probe\n"), 0o644)
		if err != nil {
			fmt.Println("denied:", err)
			return
		}
		fmt.Println("ok")
	case "sleep":
		sec := 30
		if len(args) > 1 {
			if v, err := strconv.Atoi(args[1]); err == nil {
				sec = v
			}
		}
		time.Sleep(time.Duration(sec) * time.Second)
		fmt.Println("slept", sec)
	default:
		fmt.Fprintf(os.Stderr, "unknown subcommand %q\n", args[0])
		os.Exit(2)
	}
}
