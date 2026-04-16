import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { http } from './http';

export interface ICard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text: string;
  has_image: boolean;
  z_index: number;
  card_type: 'note' | 'image' | 'totp' | 'container';
  is_secret: boolean;
  totp_name?: string;
  container_id: string | null;
  title: string;
  updated_at: string;
}

export const CARD_TYPE_COLORS = {
  note: '#fde68a',
  secret: '#fbcfe8',
  image: '#bfdbfe',
  totp: '#bbf7d0',
} as const;

export function getCardTypeColor(card: ICard): string {
  if (card.card_type === 'container') return card.color;
  if (card.is_secret) return CARD_TYPE_COLORS.secret;
  if (card.card_type === 'image') return CARD_TYPE_COLORS.image;
  if (card.card_type === 'totp') return CARD_TYPE_COLORS.totp;
  return CARD_TYPE_COLORS.note;
}

export interface ITotpCode {
  code: string;
  remaining: number;
  period: number;
}

export interface ITotpBatchResponse {
  codes: Record<string, { code: string }>;
  remaining: number;
  period: number;
}

export type CardPatch = Partial<
  Pick<ICard, 'x' | 'y' | 'width' | 'height' | 'color' | 'text' | 'title' | 'z_index' | 'is_secret'>
> & { container_id?: string };

@Injectable({ providedIn: 'root' })
export class CardService {
  private base = '/cards';
  private totpBase = '/totps';

  async list(): Promise<ICard[]> {
    const { data } = await http.get<ICard[]>(this.base);
    return data;
  }

  async create(body: {
    x: number;
    y: number;
    width?: number;
    height?: number;
    color?: string;
    text?: string;
    title?: string;
    card_type?: string;
    is_secret?: boolean;
  }): Promise<ICard> {
    const { data } = await http.post<ICard>(this.base, body);
    return data;
  }

  async patch(id: string, body: CardPatch): Promise<ICard> {
    const rounded = { ...body };
    if (rounded.x != null) rounded.x = Math.round(rounded.x);
    if (rounded.y != null) rounded.y = Math.round(rounded.y);
    if (rounded.width != null) rounded.width = Math.round(rounded.width);
    if (rounded.height != null) rounded.height = Math.round(rounded.height);
    const { data } = await http.patch<ICard>(`${this.base}/${id}`, rounded);
    return data;
  }

  async delete(id: string): Promise<void> {
    await http.delete<void>(`${this.base}/${id}`);
  }

  async uploadImage(id: string, file: File): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    await http.post<void>(`${this.base}/${id}/image`, form);
  }

  async removeImage(id: string): Promise<void> {
    await http.delete<void>(`${this.base}/${id}/image`);
  }

  async createTotp(body: {
    x: number;
    y: number;
    color?: string;
    totp_secret: string;
    totp_name: string;
  }): Promise<ICard> {
    const { data } = await http.post<ICard>(this.base, { ...body, card_type: 'totp' });
    return data;
  }

  async getTotp(id: string): Promise<ITotpCode> {
    const { data } = await http.get<ITotpCode>(`${this.totpBase}/${id}`);
    return data;
  }

  async getAllTotp(): Promise<ITotpBatchResponse> {
    const { data } = await http.get<ITotpBatchResponse>(this.totpBase);
    return data;
  }

  imageUrl(id: string, updatedAt: string): string {
    return `${environment.apiBase}${this.base}/${id}/image?v=${encodeURIComponent(updatedAt)}`;
  }
}
