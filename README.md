# KI-Wissen

A presentation of **KIA Home**, a self-hosted personal AI system I designed and built:
hybrid retrieval (pgvector + PostgreSQL full-text, fused by reciprocal rank), two model
providers behind one call site each, local speech-to-text and OCR, and per-call cost
accounting.

**→ https://cristiv123.github.io/KI-Wissen/** — in German, French, Italian, English and
Romanian.

This repository contains the presentation page only. The application's source is private.

---

## Refreshing the figures

Sixteen figures in five languages, and they go stale together: every one of them carries
the navigation bar, so one menu entry added to the application dates all eighty at once.
`tools/shoot.mjs` is what takes them.

It needs no `npm install` — Node 22 ships a global `WebSocket` and the machine ships
Chrome, so it drives the installed browser over the DevTools Protocol directly. The
geometry is the page's own: a 1360×850 viewport at `deviceScaleFactor` 2, so 2720×1700,
with `find` and `help` laid out at a taller viewport and `languages` cropped to its top.
A taller *viewport* rather than a taller capture, because this application's layout is
height-driven: capturing beyond an 850px viewport reflows nothing and returns the page
cut at 850 with grey underneath it.

**Two instances are involved and they are not interchangeable.** Fifteen figures come
from a seeded demo instance: the same application and the same migrations against a
schema of its own, filled with invented people, addresses and documents whose mail
domains are the ones RFC 2606 reserves. `ai-usage` alone comes from the real instance,
because that figure's entire worth is that the amounts in it were measured — seeding
plausible numbers there would manufacture exactly the kind of evidence this page should
not offer. The script will not shoot it by accident: a figure marked `instance: 'real'`
is skipped unless it is asked for by name.

### The demo instance

A second backend against the `kia_demo` schema, on its own port, with every scheduler
neutralised — the overrides the application's own test profile already uses. The last of
them is not optional: the reminder dispatcher **writes** before it tries to send, so left
alone it would mark demo rows as missed while the figures were being taken, and the
owner's real SMTP credentials would send mail to the invented addresses.

```
cd <kia-home>/kia-backend
./mvnw.cmd spring-boot:run "-Dspring-boot.run.jvmArguments=-Dserver.port=8082 -Dspring.datasource.url=jdbc:postgresql://localhost:5432/kia?currentSchema=kia_demo,public -Dspring.jpa.properties.hibernate.default_schema=kia_demo -Dspring.flyway.enabled=false -Dapp.mail.password= -Dapp.mail.credentials-encryption-key= -Dapp.reminders.initial-delay-ms=86400000 -Dapp.email.categorization.enabled=false -Dapp.ocr.enabled=false"
```

Ollama has to stay reachable: the retrieval figure embeds its own question, so pointing
that base URL at a dead port makes `second-brain` the one figure that fails.

A dev server in front of it, with a proxy config that is deliberately **not** the
repository's own — `proxy.conf.json` is committed and points at the real backend:

```
cd <kia-home>/kia-frontend
npx ng serve --port 4202 --proxy-config <somewhere>/proxy.demo.json
```

The demo account is `demo` / `ChangeMe123!` — invented, and an `APP_ADMIN`, which is what
makes `/users`, `/settings` and all eighteen chapters of the manual appear.

### Taking them

```
node tools/shoot.mjs                    # the fifteen demo figures, all five languages
node tools/shoot.mjs --lang de          # one language
node tools/shoot.mjs --only help,find   # one or two figures

# the cost ledger, from the real instance: Chrome opens with a window and waits for you
# to sign in, so no password is in this repository or passes through the script
node tools/shoot.mjs --only ai-usage --base http://localhost:4201 --wait-for-login
```

Afterwards, two things:

**Bump `SHOTS_VERSION` in `index.html`.** The eighty images keep the same eighty
addresses forever and GitHub Pages serves them with `Cache-Control: max-age=600`, so
without a new token a browser that has seen the page before goes on showing the figures
it already holds. That is how the first retake shipped: the published files were correct
and the first reader saw the old English set out of their own cache. A refresh nobody can
see is a refresh that did not happen.

**Correct `fig.usage` in all five tables**, reading the three numbers off the new
`ai-usage` image. That caption quotes what is in the figure, so it goes stale the moment
the figure is retaken.

## Recounting the figures in §04

Counted by this method, which is written down so that the next count is the same count —
the figures it replaced could not be reproduced by any obvious one:

```
git ls-files '*.java' '*.ts' '*.html' '*.scss' '*.sql' '*.py' \
  | grep -v '^kia-whisper/\.venv/' | xargs cat | wc -l
```

Tests are counted literally rather than as a runner reports them: `@Test` occurrences
under `kia-backend/src/test`, and `it(` occurrences in `kia-frontend/src/**/*.spec.ts`.
The i18n figure is leaf keys per translation file, the way the application's own parity
test counts them.
