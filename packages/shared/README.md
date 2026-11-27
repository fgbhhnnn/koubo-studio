# @koubo/shared

What OpenFilm's clients share: a chat turn and the events a client sees, how an agent's activity reads, prompt
references, title limits and Markdown parsing.

```ts
import { buildPromptDisplay, type Turn } from '@koubo/shared';
import { scanMarkdownBlocks } from '@koubo/shared/markdown';
```

Part of [OpenFilm](https://github.com/openfilm/openfilm). MIT licensed.
