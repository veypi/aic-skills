package skillproc

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"net"
	"testing"
	"time"
)

func TestRejectOldAndAmbiguousHeaders(t *testing.T) {
	for _, header := range []string{`{"v":1,"type":"invoke"}`, `{"v":2,"type":"invoke","id":"x"}`, `{"v":2,"type":"invoke"}{}`} {
		var wire bytes.Buffer
		_ = binary.Write(&wire, binary.BigEndian, uint32(len(header)))
		wire.WriteString(header)
		if _, _, err := ReadFrame(&wire); err == nil {
			t.Fatalf("accepted %s", header)
		}
	}
}

func TestDisconnectCancelsHandler(t *testing.T) {
	for _, kind := range []string{TypeInvoke, TypeStreamOpen} {
		t.Run(kind, func(t *testing.T) {
			server, client := net.Pipe()
			defer client.Close()
			entered := make(chan struct{})
			finished := make(chan struct{})
			block := func(ctx context.Context) { close(entered); <-ctx.Done() }
			go func() {
				defer close(finished)
				ServeConn(context.Background(), NewConn(server),
					func(ctx context.Context, _ Header, _ []byte, _, _ io.Writer) (int, error) {
						block(ctx)
						return 124, ctx.Err()
					},
					func(ctx context.Context, _ string, _ []byte) (Stream, error) { block(ctx); return nil, ctx.Err() })
			}()
			if err := WriteFrame(client, Header{Type: kind}, nil); err != nil {
				t.Fatal(err)
			}
			select {
			case <-entered:
			case <-time.After(time.Second):
				t.Fatal("handler did not start")
			}
			_ = client.Close()
			select {
			case <-finished:
			case <-time.After(time.Second):
				t.Fatal("disconnect did not cancel handler")
			}
		})
	}
}

func TestSecondInvokeCancelsWithoutExecuting(t *testing.T) {
	server, client := net.Pipe()
	defer client.Close()
	entered := make(chan struct{})
	finished := make(chan struct{})
	calls := 0
	go func() {
		defer close(finished)
		ServeConn(context.Background(), NewConn(server), func(ctx context.Context, _ Header, _ []byte, _, _ io.Writer) (int, error) {
			calls++
			close(entered)
			<-ctx.Done()
			return 1, ctx.Err()
		}, nil)
	}()
	if err := WriteFrame(client, Header{Type: TypeInvoke}, nil); err != nil {
		t.Fatal(err)
	}
	<-entered
	_ = WriteFrame(client, Header{Type: TypeInvoke}, nil)
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("second invoke did not terminate connection")
	}
	if calls != 1 {
		t.Fatalf("calls=%d", calls)
	}
}
