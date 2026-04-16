import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { Card, CardService } from '../../core/api/card.service';

type DragMode = 'move' | 'resize' | null;

@Component({
  selector: 'app-card',
  standalone: true,
  templateUrl: './card.html',
  styleUrl: './card.css',
})
export class CardComponent {
  private cards = inject(CardService);

  @Input({ required: true }) card!: Card;
  @Output() changed = new EventEmitter<Card>();
  @Output() deleted = new EventEmitter<string>();
  @Output() contextRequested = new EventEmitter<{ card: Card; x: number; y: number }>();

  readonly editing = signal(false);
  @ViewChild('ta') ta?: ElementRef<HTMLTextAreaElement>;

  private mode: DragMode = null;
  private startX = 0;
  private startY = 0;
  private origX = 0;
  private origY = 0;
  private origW = 0;
  private origH = 0;

  onHeaderPointerDown(ev: PointerEvent) {
    if (this.editing()) return;
    this.mode = 'move';
    this.startDrag(ev);
  }

  onResizePointerDown(ev: PointerEvent) {
    this.mode = 'resize';
    this.startDrag(ev);
    ev.stopPropagation();
  }

  private startDrag(ev: PointerEvent) {
    ev.preventDefault();
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    this.startX = ev.clientX;
    this.startY = ev.clientY;
    this.origX = this.card.x;
    this.origY = this.card.y;
    this.origW = this.card.width;
    this.origH = this.card.height;
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp, { once: true });
  }

  private onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - this.startX;
    const dy = ev.clientY - this.startY;
    if (this.mode === 'move') {
      this.card = { ...this.card, x: Math.max(0, this.origX + dx), y: Math.max(0, this.origY + dy) };
    } else if (this.mode === 'resize') {
      this.card = {
        ...this.card,
        width: Math.max(120, this.origW + dx),
        height: Math.max(90, this.origH + dy),
      };
    }
    this.changed.emit(this.card);
  };

  private onUp = async () => {
    window.removeEventListener('pointermove', this.onMove);
    const mode = this.mode;
    this.mode = null;
    if (mode === 'move') {
      await this.persist({ x: this.card.x, y: this.card.y });
    } else if (mode === 'resize') {
      await this.persist({ width: this.card.width, height: this.card.height });
    }
  };

  private async persist(body: Partial<Card>) {
    try {
      const updated = await this.cards.patch(this.card.id, body);
      this.card = updated;
      this.changed.emit(this.card);
    } catch (e) {
      console.error('patch failed', e);
    }
  }

  onContextMenu(ev: MouseEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    this.contextRequested.emit({ card: this.card, x: ev.clientX, y: ev.clientY });
  }

  startEdit() {
    this.editing.set(true);
    queueMicrotask(() => this.ta?.nativeElement.focus());
  }

  async commitEdit() {
    const value = this.ta?.nativeElement.value ?? this.card.text;
    this.editing.set(false);
    if (value === this.card.text) return;
    this.card = { ...this.card, text: value };
    await this.persist({ text: value });
  }

  imageUrl(): string {
    return this.cards.imageUrl(this.card.id, this.card.updated_at);
  }
}
