#!/bin/bash
# Sourced by every interactive shell in the task containers.
#
# Agents deliver multi-hundred-line files by pasting a single heredoc into the
# terminal. A burst that large can wedge the pty: one stray 0x13 in the stream
# is XOFF, and with the default line discipline that stops the terminal dead
# with no way back in-band, because 0x11 (XON) is itself part of the frozen
# stream. A wedged pane costs the whole trial, so flow control is off here.
if [ -t 0 ]; then
    stty -ixon -ixoff 2>/dev/null || true
fi
