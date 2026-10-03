package skillproc

import (
	"context"
	"fmt"
	"io"
)

// Stream preserves message boundaries; Close must unblock Send and Recv.
type Stream interface {
	Send(context.Context, []byte) error
	Recv(context.Context) ([]byte, error)
	Close() error
}
type InvokeFunc func(context.Context, Header, []byte, io.Writer, io.Writer) (int, error)
type OpenFunc func(context.Context, string, []byte) (Stream, error)

// ServeConn handles one request. Closing the connection cancels its work.
// Handlers must observe ctx; stream Close must unblock its reader and writer.
func ServeConn(ctx context.Context, conn *Conn, invoke InvokeFunc, open OpenFunc) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	fail := func(err error) { _ = conn.Send(Header{Type: TypeError, Error: err.Error()}, nil) }
	h, payload, err := conn.Recv()
	if err != nil {
		return
	}
	if h.Type != TypeInvoke && h.Type != TypeStreamOpen {
		fail(fmt.Errorf("expected invoke or stream.open, got %q", h.Type))
		return
	}
	// A single reader also observes disconnect while a handler starts or blocks.
	type frame struct {
		header  Header
		payload []byte
	}
	frames := make(chan frame, 1)
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		defer cancel()
		for {
			next, b, err := conn.Recv()
			if err != nil {
				return
			}
			if h.Type == TypeInvoke {
				return
			} // A second invoke is never executed.
			select {
			case frames <- frame{next, b}:
			case <-ctx.Done():
				return
			}
		}
	}()
	defer func() { cancel(); _ = conn.Close(); <-readerDone }()
	if h.Type == TypeInvoke {
		if invoke == nil {
			fail(fmt.Errorf("invoke unavailable"))
			return
		}
		code, err := invoke(ctx, h, payload, frameWriter{conn, StreamStdout}, frameWriter{conn, StreamStderr})
		terminal := Header{Type: TypeExit, Code: code}
		if err != nil {
			terminal.Error = err.Error()
			if code == 0 {
				terminal.Code = 1
			}
		}
		_ = conn.Send(terminal, nil)
		return
	}
	if open == nil {
		fail(fmt.Errorf("streams unavailable"))
		return
	}
	st, err := open(ctx, h.Name, payload)
	if err != nil {
		fail(err)
		return
	}
	outputDone := make(chan struct{})
	go func() {
		defer close(outputDone)
		defer cancel()
		for {
			b, err := st.Recv(ctx)
			if err != nil {
				terminal := Header{Type: TypeStreamClose}
				if err != io.EOF {
					terminal.Error = err.Error()
				}
				_ = conn.Send(terminal, nil)
				return
			}
			if err := conn.Send(Header{Type: TypeStreamFrame}, b); err != nil {
				return
			}
		}
	}()
	defer func() { cancel(); _ = conn.Close(); _ = st.Close(); <-outputDone }()
	for {
		select {
		case <-ctx.Done():
			return
		case next := <-frames:
			switch next.header.Type {
			case TypeStreamFrame:
				if err := st.Send(ctx, next.payload); err != nil {
					fail(err)
					return
				}
			case TypeStreamClose:
				return
			default:
				fail(fmt.Errorf("unexpected stream frame %q", next.header.Type))
				return
			}
		}
	}
}

type frameWriter struct {
	conn   *Conn
	stream string
}

func (w frameWriter) Write(p []byte) (int, error) {
	if err := w.conn.Send(Header{Type: TypeFrame, Stream: w.stream}, p); err != nil {
		return 0, err
	}
	return len(p), nil
}
