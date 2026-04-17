import { Component, OnInit, inject } from '@angular/core';
import { HeaderComponent } from '../../components/header/header';
import { CanvasBoardComponent } from '../../components/canvas-board/canvas-board';
import { WorkspaceSidebar } from '../../components/workspace-sidebar/workspace-sidebar';
import { WorkspaceService } from '../../core/workspace/workspace.service';

@Component({
  selector: 'app-canvas-page',
  standalone: true,
  imports: [HeaderComponent, CanvasBoardComponent, WorkspaceSidebar],
  template: `
    <app-workspace-sidebar />
    <app-header />
    <app-canvas-board />
  `,
})
export class CanvasPage implements OnInit {
  private workspaces = inject(WorkspaceService);

  async ngOnInit(): Promise<void> {
    await this.workspaces.load();
  }
}
