import { Pipe, type PipeTransform } from '@angular/core';
import { Marked } from 'marked';

const md = new Marked({ gfm: true, async: false });

/**
 * Renders Markdown to an HTML string. Bind the result with [innerHTML]:
 * Angular's built-in sanitizer then strips scripts, event handlers and other unsafe markup.
 */
@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return value ? md.parse(value, { async: false }) : '';
  }
}
