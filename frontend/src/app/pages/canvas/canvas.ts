import { Component } from '@angular/core';
import { HeaderComponent } from '../../components/header/header';
import { CanvasBoardComponent } from '../../components/canvas-board/canvas-board';

@Component({
  selector: 'app-canvas-page',
  standalone: true,
  imports: [HeaderComponent, CanvasBoardComponent],
  template: `
    <app-header />
    <app-canvas-board />
  `,
})
export class CanvasPage {}
