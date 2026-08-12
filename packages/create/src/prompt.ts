/**
 * A zero-dependency arrow-key select — the scaffolder's whole UI.
 *
 * ↑/↓ move, Enter confirms, Ctrl+C cancels (exit 130, cursor restored).
 * After a choice the list collapses to one confirmation line, clack-style.
 * Only ever called on a real TTY — non-interactive runs take defaults
 * before this module is reached.
 */

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

const VIOLET = '\x1b[38;2;139;123;255m'; // Amo Violet #8B7BFF
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

export function select(question: string, options: SelectOption[]): Promise<string> {
  const stdin = process.stdin;
  const out = process.stdout;

  return new Promise((resolve) => {
    let current = 0;

    const line = (o: SelectOption, active: boolean): string =>
      active
        ? `  ${VIOLET}❯ ${o.label}${RESET}${o.hint ? ` ${DIM}${o.hint}${RESET}` : ''}\n`
        : `  ${DIM}  ${o.label}${o.hint ? ` ${o.hint}` : ''}${RESET}\n`;

    const render = (first: boolean): void => {
      if (!first) out.write(`\x1b[${options.length + 1}A`); // back to the question line
      out.write('\r\x1b[J'); // clear everything below
      out.write(`${VIOLET}◆${RESET} ${question}\n`);
      options.forEach((o, i) => out.write(line(o, i === current)));
    };

    const close = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onKey);
      out.write(SHOW_CURSOR);
    };

    const onKey = (buf: Buffer): void => {
      const key = buf.toString();
      if (key === '\x03' || key === '\x1b') {
        // Ctrl+C or a bare Escape — leave the terminal as we found it
        close();
        out.write(`\n${DIM}cancelled${RESET}\n`);
        process.exit(130);
      }
      if (key === '\x1b[A' || key === 'k') current = (current - 1 + options.length) % options.length;
      else if (key === '\x1b[B' || key === 'j') current = (current + 1) % options.length;
      else if (key === '\r' || key === '\n') {
        close();
        // collapse the menu to one confirmed line
        out.write(`\x1b[${options.length + 1}A\r\x1b[J`);
        out.write(`${VIOLET}◇${RESET} ${question} ${DIM}·${RESET} ${options[current].label}\n`);
        resolve(options[current].value);
        return;
      }
      render(false);
    };

    out.write(HIDE_CURSOR);
    render(true);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.on('data', onKey);
  });
}
