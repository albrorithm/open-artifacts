# Repository workflow

Work directly on `main`. Do not create or switch to a feature branch or worktree unless the user explicitly requests one.

Keep the Sites and Tailscale plugin paths usable by simple agent models. When changing either workflow, test both with fresh agents that receive no implementation history or expected answers. Preserve test inputs and raw results privately.

Use synthetic artifacts for testing. Keep private endpoint settings and test records outside committed source.
