import { Pipe, type PipeTransform } from '@angular/core';

/** 1 → "+1", -2 → "−2": learned adjustments are shown with their sign. */
@Pipe({ name: 'signed' })
export class SignedPipe implements PipeTransform {
  transform(value: number): string {
    return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0';
  }
}
