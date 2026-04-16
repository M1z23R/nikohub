import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

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

export interface ITotpCode {
  code: string;
  remaining: number;
  period: number;
}

export type CardPatch = Partial<Pick<ICard, 'x' | 'y' | 'width' | 'height' | 'color' | 'text' | 'title' | 'z_index' | 'is_secret'>> & { container_id?: string };

@Injectable({ providedIn: 'root' })
export class CardService {
  private http = inject(HttpClient);
  private base = `${environment.apiBase}/cards`;

  list(): Promise<ICard[]> {
    return firstValueFrom(this.http.get<ICard[]>(this.base));
  }

  create(body: { x: number; y: number; width?: number; height?: number; color?: string; text?: string; title?: string; card_type?: string; is_secret?: boolean }): Promise<ICard> {
    return firstValueFrom(this.http.post<ICard>(this.base, body));
  }

  patch(id: string, body: CardPatch): Promise<ICard> {
    return firstValueFrom(this.http.patch<ICard>(`${this.base}/${id}`, body));
  }

  delete(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/${id}`));
  }

  uploadImage(id: string, file: File): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    return firstValueFrom(this.http.post<void>(`${this.base}/${id}/image`, form));
  }

  removeImage(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/${id}/image`));
  }

  createTotp(body: { x: number; y: number; color?: string; totp_secret: string; totp_name: string }): Promise<ICard> {
    return firstValueFrom(this.http.post<ICard>(this.base, { ...body, card_type: 'totp' }));
  }

  getTotp(id: string): Promise<ITotpCode> {
    return firstValueFrom(this.http.get<ITotpCode>(`${this.base}/${id}/totp`));
  }

  imageUrl(id: string, updatedAt: string): string {
    return `${this.base}/${id}/image?v=${encodeURIComponent(updatedAt)}`;
  }
}
