import { Injectable, signal } from '@angular/core';
import { http } from './http';
import { ICard } from './card.service';

export type CardTypeColorKey = 'note' | 'secret' | 'image' | 'totp' | 'password';

export const CARD_TYPE_COLOR_DEFAULTS: Record<CardTypeColorKey, string> = {
  note: '#fde68a',
  secret: '#fbcfe8',
  image: '#bfdbfe',
  totp: '#bbf7d0',
  password: '#ddd6fe',
};

@Injectable({ providedIn: 'root' })
export class CardTypeColorsService {
  private base = '/card-type-colors';
  private map = signal<Record<string, string>>({ ...CARD_TYPE_COLOR_DEFAULTS });
  readonly colors = this.map.asReadonly();

  async load(): Promise<void> {
    const { data } = await http.get<Record<string, string>>(this.base);
    this.map.set({ ...CARD_TYPE_COLOR_DEFAULTS, ...data });
  }

  async setColor(cardType: CardTypeColorKey, color: string): Promise<void> {
    await http.patch(`${this.base}/${cardType}`, { color });
    this.map.update((m) => ({ ...m, [cardType]: color }));
  }

  resolve(card: ICard): string {
    const m = this.map();
    if (card.card_type === 'container') return card.color;
    if (card.card_type === 'password') return m['password'];
    if (card.is_secret) return m['secret'];
    if (card.card_type === 'image') return m['image'];
    if (card.card_type === 'totp') return m['totp'];
    return m['note'];
  }
}
