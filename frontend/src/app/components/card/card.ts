import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  inject,
  signal,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { ICard, CardService, CardPatch } from '../../core/api/card.service';
import { CardTypeColorsService } from '../../core/api/card-type-colors.service';
import { SnapContext } from '../../core/snap';

type DragMode = 'move' | 'resize' | null;

@Component({
  selector: 'app-card',
  standalone: true,
  imports: [],
  templateUrl: './card.html',
  styleUrl: './card.css',
})
export class CardComponent implements OnInit, OnDestroy {
  private cards = inject(CardService);
  private snapCtx = inject(SnapContext);
  private colorsSvc = inject(CardTypeColorsService);

  @Input({ required: true }) card!: ICard;
  @Input() highlighted = false;
  @Input() isSelected = false;
  @Input() scale = 1;
  @Input() totpCode = '';
  @Input() set revealToken(tok: { id: string; n: number } | null) {
    if (tok && this.card && tok.id === this.card.id) this.revealed.set(true);
  }
  @Output() changed = new EventEmitter<ICard>();
  @Output() deleted = new EventEmitter<string>();
  @Output() dropped = new EventEmitter<ICard>();
  @Output() moveStarted = new EventEmitter<string>();
  @Output() contextRequested = new EventEmitter<{ card: ICard; x: number; y: number }>();

  readonly editing = signal(false);
  readonly editingTitle = signal(false);
  readonly revealed = signal(false);
  readonly copied = signal(false);
  @ViewChild('ta') ta?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('titleInput') titleInput?: ElementRef<HTMLInputElement>;

  private copiedTimeout: ReturnType<typeof setTimeout> | null = null;

  private mode: DragMode = null;
  private startX = 0;
  private startY = 0;
  private origX = 0;
  private origY = 0;
  private origW = 0;
  private origH = 0;

  ngOnInit() {
    if (this.card.is_secret && !this.card.text) {
      this.revealed.set(true);
    }
  }

  ngOnDestroy() {
    if (this.copiedTimeout) clearTimeout(this.copiedTimeout);
  }

  get isHidden(): boolean {
    return this.card.card_type === 'totp' || this.card.card_type === 'password' || this.card.is_secret;
  }

  toggleReveal() {
    this.revealed.set(!this.revealed());
  }

  async toggleFavorite() {
    const next = !this.card.is_favorite;
    this.card = { ...this.card, is_favorite: next };
    this.changed.emit(this.card);
    await this.persist({ is_favorite: next } as CardPatch);
  }

  async copyText() {
    const text = this.card.card_type === 'totp' ? this.totpCode : this.card.text;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    this.copied.set(true);
    if (this.copiedTimeout) clearTimeout(this.copiedTimeout);
    this.copiedTimeout = setTimeout(() => this.copied.set(false), 1500);
  }

  maskedText(): string {
    return this.card.text.replace(/./g, '\u2022');
  }

  maskedTotp(): string {
    return '\u2022\u2022\u2022 \u2022\u2022\u2022';
  }

  formattedTotp(): string {
    const code = this.totpCode;
    if (code.length === 6) return code.slice(0, 3) + ' ' + code.slice(3);
    return code;
  }

  onHeaderPointerDown(ev: PointerEvent) {
    if (this.editing()) return;
    if (ev.ctrlKey || ev.metaKey) return;
    this.moveStarted.emit(this.card.id);
    this.mode = 'move';
    this.startDrag(ev);
  }

  onResizePointerDown(ev: PointerEvent) {
    this.moveStarted.emit(this.card.id);
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
    const dx = (ev.clientX - this.startX) / this.scale;
    const dy = (ev.clientY - this.startY) / this.scale;
    if (this.mode === 'move') {
      let x = this.origX + dx;
      let y = this.origY + dy;
      const snap = this.snapCtx.snapMove({ x, y, width: this.card.width, height: this.card.height });
      if (snap) { x = snap.x; y = snap.y; }
      this.card = { ...this.card, x, y };
    } else if (this.mode === 'resize') {
      let width = Math.max(120, this.origW + dx);
      let height = Math.max(90, this.origH + dy);
      const snap = this.snapCtx.snapResize({ x: this.card.x, y: this.card.y, width, height });
      if (snap) {
        width = Math.max(120, snap.width);
        height = Math.max(90, snap.height);
      }
      this.card = { ...this.card, width, height };
    }
    this.changed.emit(this.card);
  };

  private onUp = async () => {
    window.removeEventListener('pointermove', this.onMove);
    this.snapCtx.deactivate();
    const mode = this.mode;
    this.mode = null;
    if (mode === 'move') {
      await this.persist({ x: this.card.x, y: this.card.y });
      this.dropped.emit(this.card);
    } else if (mode === 'resize') {
      await this.persist({ width: this.card.width, height: this.card.height });
    }
  };

  private async persist(body: CardPatch) {
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

  onTextDblClick(ev: MouseEvent) {
    if (this.card.is_secret && !this.revealed()) return;
    ev.stopPropagation();
    this.editing.set(true);
    requestAnimationFrame(() => this.ta?.nativeElement.focus());
  }

  async commitEdit() {
    const value = this.ta?.nativeElement.value ?? this.card.text;
    this.editing.set(false);
    if (value === this.card.text) return;
    this.card = { ...this.card, text: value };
    await this.persist({ text: value });
  }

  onTitleDblClick(ev: MouseEvent) {
    ev.stopPropagation();
    this.editingTitle.set(true);
    requestAnimationFrame(() => this.titleInput?.nativeElement.focus());
  }

  async commitTitleEdit() {
    const value = this.titleInput?.nativeElement.value ?? this.card.title;
    this.editingTitle.set(false);
    if (value === this.card.title) return;
    this.card = { ...this.card, title: value };
    await this.persist({ title: value });
  }

  get cardBackground(): string {
    if (this.card.card_type === 'container') {
      return `color-mix(in srgb, ${this.card.color} 20%, transparent)`;
    }
    return this.colorsSvc.resolve(this.card);
  }

  imageUrl(): string {
    return this.cards.imageUrl(this.card.id, this.card.updated_at);
  }
}
