import { Component, inject } from '@angular/core';
import {
  ButtonComponent,
  DialogService,
  DropdownComponent,
  DropdownItemComponent,
  DropdownTriggerDirective,
} from '@m1z23r/ngx-ui';
import { IWorkspace, WorkspaceService } from '../../core/workspace/workspace.service';
import { WorkspaceDialog } from '../workspace-dialog/workspace-dialog';
import { WorkspaceSettings } from '../workspace-settings/workspace-settings';

@Component({
  selector: 'app-workspace-sidebar',
  standalone: true,
  imports: [
    ButtonComponent,
    DropdownComponent,
    DropdownItemComponent,
    DropdownTriggerDirective,
  ],
  templateUrl: './workspace-sidebar.html',
  styleUrl: './workspace-sidebar.css',
})
export class WorkspaceSidebar {
  private svc = inject(WorkspaceService);
  private dialog = inject(DialogService);

  readonly list = this.svc.list;
  readonly activeId = this.svc.activeId;

  select(w: IWorkspace): void {
    this.svc.setActive(w.id);
  }

  openNewOrJoin(): void {
    this.dialog.open(WorkspaceDialog, { size: 'sm', closeOnBackdropClick: true });
  }

  openSettings(w: IWorkspace): void {
    if (!w.id) return;
    this.dialog.open(WorkspaceSettings, {
      size: 'md',
      closeOnBackdropClick: true,
      data: { workspaceId: w.id },
    });
  }

  async leave(w: IWorkspace): Promise<void> {
    if (!w.id) return;
    await this.svc.leave(w.id);
  }
}
