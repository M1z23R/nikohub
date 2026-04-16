import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Card {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text: string;
  has_image: boolean;
  z_index: number;
  updated_at: string;
}

export type CardPatch = Partial<Pick<Card, 'x' | 'y' | 'width' | 'height' | 'color' | 'text' | 'z_index'>>;

@Injectable({ providedIn: 'root' })
export class CardService {
  private http = inject(HttpClient);
  private base = `${environment.apiBase}/cards`;

  list(): Promise<Card[]> {
    return firstValueFrom(this.http.get<Card[]>(this.base));
  }

  create(body: { x: number; y: number; color?: string; text?: string }): Promise<Card> {
    return firstValueFrom(this.http.post<Card>(this.base, body));
  }

  patch(id: string, body: CardPatch): Promise<Card> {
    return firstValueFrom(this.http.patch<Card>(`${this.base}/${id}`, body));
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

  imageUrl(id: string, updatedAt: string): string {
    return `${this.base}/${id}/image?v=${encodeURIComponent(updatedAt)}`;
  }
}
