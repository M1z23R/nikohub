# @m1z23r/ngx-ui — Component Reference

Angular 21+ standalone component library. Signal-based, OnPush, CSS custom properties for theming.

```bash
npm install @m1z23r/ngx-ui
```

All components use the `ui-` selector prefix. Import directly — no NgModules.

---

## Table of Contents

- [Button](#button)
- [Input](#input)
- [Textarea](#textarea)
- [Checkbox](#checkbox)
- [Switch](#switch)
- [Radio Group](#radio-group)
- [Select](#select)
- [Chip Input](#chip-input)
- [Slider](#slider)
- [Datepicker](#datepicker)
- [Timepicker](#timepicker)
- [Datetimepicker](#datetimepicker)
- [File Chooser](#file-chooser)
- [Template Input](#template-input)
- [Badge](#badge)
- [Alert](#alert)
- [Card](#card)
- [Spinner](#spinner)
- [Progress](#progress)
- [Circular Progress](#circular-progress)
- [Pagination](#pagination)
- [Tabs](#tabs)
- [Dynamic Tabs](#dynamic-tabs)
- [Accordion](#accordion)
- [Table](#table)
- [Dropdown](#dropdown)
- [Tooltip](#tooltip)
- [Tree](#tree)
- [Split Panes](#split-panes)
- [Modal](#modal)
- [Layout (Shell)](#layout-shell)
- [Dialog Service](#dialog-service)
- [Toast Service](#toast-service)
- [Loading Service](#loading-service)
- [Sidebar Service](#sidebar-service)
- [CSS Variables](#css-variables)

---

## Button

**Selector:** `ui-button`

| Input | Type | Default |
|-------|------|---------|
| `variant` | `'default' \| 'outline' \| 'ghost' \| 'elevated'` | `'default'` |
| `color` | `'primary' \| 'secondary' \| 'danger' \| 'success' \| 'warning'` | `'primary'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `type` | `'button' \| 'submit' \| 'reset'` | `'button'` |
| `disabled` | `boolean` | `false` |
| `loading` | `boolean` | `false` |

| Output | Type |
|--------|------|
| `clicked` | `MouseEvent` |

Implements `Loadable` for `LoadingDirective` integration.

```html
<ui-button variant="outline" color="danger" size="lg" (clicked)="onDelete()">
  Delete
</ui-button>

<ui-button [loading]="isSaving()" (clicked)="save()">Save</ui-button>
```

---

## Input

**Selector:** `ui-input`

| Input | Type | Default |
|-------|------|---------|
| `type` | `'text' \| 'password' \| 'email' \| 'number' \| 'tel' \| 'url'` | `'text'` |
| `label` | `string` | `''` |
| `placeholder` | `string` | `''` |
| `hint` | `string` | `''` |
| `error` | `string` | `''` |
| `disabled` | `boolean` | `false` |
| `readonly` | `boolean` | `false` |
| `required` | `boolean` | `false` |
| `id` | `string` | `''` |
| `validators` | `ValidatorFn[]` | `[]` |
| `validatorFn` | `ValidatorFn \| null` | `null` |
| `showErrorsOn` | `'touched' \| 'dirty' \| 'always'` | `'touched'` |

| Model | Type |
|-------|------|
| `value` | `string \| number` |

**Exposed signals:** `touched`, `dirty`, `validationState`
**Methods:** `reset()`, `markAsTouched()`, `markAsDirty()`, `hasError(key)`, `getError(key)`

```html
<ui-input
  label="Email"
  type="email"
  placeholder="you@example.com"
  hint="We won't share your email"
  [(value)]="email"
  [required]="true"
/>
```

---

## Textarea

**Selector:** `ui-textarea`

| Input | Type | Default |
|-------|------|---------|
| `label` | `string` | `''` |
| `placeholder` | `string` | `''` |
| `hint` | `string` | `''` |
| `error` | `string` | `''` |
| `disabled` | `boolean` | `false` |
| `readonly` | `boolean` | `false` |
| `required` | `boolean` | `false` |
| `rows` | `number` | `3` |
| `maxlength` | `number \| null` | `null` |
| `resize` | `'none' \| 'vertical' \| 'horizontal' \| 'both'` | `'vertical'` |
| `id` | `string` | `''` |

| Model | Type |
|-------|------|
| `value` | `string` |

```html
<ui-textarea label="Notes" placeholder="Write something..." [(value)]="notes" [rows]="5" />
```

---

## Checkbox

**Selector:** `ui-checkbox`

| Input | Type | Default |
|-------|------|---------|
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `disabled` | `boolean` | `false` |
| `indeterminate` | `boolean` | `false` |

| Model | Type |
|-------|------|
| `checked` | `boolean` |

```html
<ui-checkbox [(checked)]="agreed">I agree to the terms</ui-checkbox>
```

---

## Switch

**Selector:** `ui-switch`

| Input | Type | Default |
|-------|------|---------|
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `disabled` | `boolean` | `false` |

| Model | Type |
|-------|------|
| `checked` | `boolean` |

```html
<ui-switch [(checked)]="darkMode">Dark Mode</ui-switch>
```

---

## Radio Group

**Selectors:** `ui-radio-group`, `ui-radio`

### RadioGroup

| Input | Type | Default |
|-------|------|---------|
| `name` | `string` | random |
| `disabled` | `boolean` | `false` |
| `orientation` | `'horizontal' \| 'vertical'` | `'vertical'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `variant` | `'default' \| 'segmented'` | `'default'` |
| `ariaLabel` | `string` | `''` |

| Model | Type |
|-------|------|
| `value` | `T \| null` |

| Output | Type |
|--------|------|
| `changed` | `T \| null` |

### Radio

| Model | Type |
|-------|------|
| `value` | `T` (required) |

| Input | Type | Default |
|-------|------|---------|
| `disabled` | `boolean` | `false` |

```html
<ui-radio-group [(value)]="color" orientation="horizontal">
  <ui-radio [value]="'red'">Red</ui-radio>
  <ui-radio [value]="'green'">Green</ui-radio>
  <ui-radio [value]="'blue'">Blue</ui-radio>
</ui-radio-group>

<!-- Segmented variant -->
<ui-radio-group [(value)]="view" variant="segmented">
  <ui-radio [value]="'list'">List</ui-radio>
  <ui-radio [value]="'grid'">Grid</ui-radio>
</ui-radio-group>
```

---

## Select

**Selectors:** `ui-select`, `ui-option`

| Input | Type | Default |
|-------|------|---------|
| `variant` | `'default' \| 'outlined' \| 'filled'` | `'default'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `placeholder` | `string` | `'Select an option'` |
| `label` | `string` | `''` |
| `hint` | `string` | `''` |
| `error` | `string` | `''` |
| `disabled` | `boolean` | `false` |
| `multiple` | `boolean` | `false` |
| `searchable` | `boolean` | `false` |
| `clearable` | `boolean` | `false` |
| `creatable` | `boolean` | `false` |
| `deletable` | `boolean` | `false` |
| `selectable` | `boolean` | `true` |
| `asyncSearch` | `AsyncSearchFn<T> \| null` | `null` |
| `debounceTime` | `number` | `300` |
| `minSearchLength` | `number` | `0` |
| `initialLoad` | `boolean` | `false` |
| `initialOptions` | `AsyncSelectOption<T>[]` | `[]` |
| `defaultOptions` | `AsyncSelectOption<T>[]` | `[]` |
| `cacheAsyncResults` | `boolean` | `false` |

| Model | Type |
|-------|------|
| `value` | `T \| T[] \| null` |

| Output | Type |
|--------|------|
| `opened` | `void` |
| `closed` | `void` |
| `created` | `string` |
| `deleted` | `T` |

```html
<!-- Basic -->
<ui-select label="Country" [(value)]="country" placeholder="Pick one">
  <ui-option [value]="'us'">United States</ui-option>
  <ui-option [value]="'uk'">United Kingdom</ui-option>
  <ui-option [value]="'de'">Germany</ui-option>
</ui-select>

<!-- Searchable + multiple -->
<ui-select label="Tags" [(value)]="tags" [multiple]="true" [searchable]="true" [clearable]="true">
  <ui-option [value]="'angular'">Angular</ui-option>
  <ui-option [value]="'react'">React</ui-option>
  <ui-option [value]="'vue'">Vue</ui-option>
</ui-select>

<!-- Async search -->
<ui-select
  label="User"
  [(value)]="selectedUser"
  [searchable]="true"
  [asyncSearch]="searchUsers"
  [debounceTime]="300"
  [minSearchLength]="2"
  [initialLoad]="true"
  [cacheAsyncResults]="true"
/>
```

**AsyncSearchFn type:** `(query: string) => Promise<AsyncSelectOption<T>[]>`
**AsyncSelectOption:** `{ value: T; label: string; disabled?: boolean }`

---

## Chip Input

**Selector:** `ui-chip-input`

| Input | Type | Default |
|-------|------|---------|
| `variant` | `'default' \| 'outlined' \| 'filled'` | `'default'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `placeholder` | `string` | `'Add item...'` |
| `label` | `string` | `''` |
| `hint` | `string` | `''` |
| `error` | `string` | `''` |
| `disabled` | `boolean` | `false` |
| `allowDuplicates` | `boolean` | `false` |
| `autoAdd` | `boolean` | `true` |

| Model | Type |
|-------|------|
| `value` | `T[]` |

| Output | Type |
|--------|------|
| `added` | `string` |
| `removed` | `T` |

Supports custom chip template via `ChipTemplateDirective`.

```html
<ui-chip-input label="Tags" [(value)]="tags" placeholder="Type and press Enter" />
```

---

## Slider

**Selector:** `ui-slider`

| Input | Type | Default |
|-------|------|---------|
| `min` | `number` | `0` |
| `max` | `number` | `100` |
| `step` | `number` | `1` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `disabled` | `boolean` | `false` |
| `showValue` | `boolean` | `false` |
| `label` | `string` | `''` |

| Model | Type |
|-------|------|
| `value` | `number` |

| Output | Type |
|--------|------|
| `valueCommit` | `number` |

```html
<ui-slider label="Volume" [(value)]="volume" [min]="0" [max]="100" [showValue]="true" />
```

---

## Datepicker

**Selector:** `ui-datepicker`

| Input | Type | Default |
|-------|------|---------|
| `variant` | `'default' \| 'outlined' \| 'filled'` | `'default'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `placeholder` | `string` | `'Select date'` |
| `label` | `string` | `''` |
| `hint` | `string` | `''` |
| `error` | `string` | `''` |
| `disabled` | `boolean` | `false` |
| `readonly` | `boolean` | `false` |
| `clearable` | `boolean` | `false` |
| `range` | `boolean` | `false` |
| `required` | `boolean` | `false` |
| `minDate` | `Date \| null` | `null` |
| `maxDate` | `Date \| null` | `null` |
| `disabledDates` | `Date[] \| ((date: Date) => boolean)` | `[]` |
| `format` | `string` | `'yyyy-MM-dd'` |
| `firstDayOfWeek` | `0 \| 1` | `1` |
| `id` | `string` | `''` |

| Model | Type |
|-------|------|
| `value` | `Date \| DateRange \| null` |

| Output | Type |
|--------|------|
| `opened` | `void` |
| `closed` | `void` |

**DateRange:** `{ start: Date | null; end: Date | null }`

```html
<ui-datepicker label="Birthday" [(value)]="birthday" [clearable]="true" />

<!-- Range -->
<ui-datepicker label="Period" [(value)]="dateRange" [range]="true" format="dd/MM/yyyy" />
```

---

## Timepicker

**Selector:** `ui-timepicker`

| Input | Type | Default |
|-------|------|---------|
| `variant` | `'default' \| 'outlined' \| 'filled'` | `'default'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `placeholder` | `string` | `'Select time'` |
| `label` | `string` | `''` |
| `hint` | `string` | `''` |
| `error` | `string` | `''` |
| `disabled` | `boolean` | `false` |
| `readonly` | `boolean` | `false` |
| `clearable` | `boolean` | `false` |
| `required` | `boolean` | `false` |
| `showSeconds` | `boolean` | `false` |
| `format` | `'12h' \| '24h'` | `'24h'` |
| `minuteStep` | `number` | `1` |
| `secondStep` | `number` | `1` |
| `minTime` | `TimeValue \| null` | `null` |
| `maxTime` | `TimeValue \| null` | `null` |
| `id` | `string` | `''` |

| Model | Type |
|-------|------|
| `value` | `TimeValue \| null` |

**TimeValue:** `{ hours: number; minutes: number; seconds?: number }`

```html
<ui-timepicker label="Start time" [(value)]="startTime" format="12h" />
```

---

## Datetimepicker

**Selector:** `ui-datetimepicker`

Combines datepicker + timepicker. Same inputs as both, plus:

| Input | Type | Default |
|-------|------|---------|
| `showSeconds` | `boolean` | `false` |
| `timeFormat` | `'12h' \| '24h'` | `'24h'` |
| `dateFormat` | `string` | `'yyyy-MM-dd'` |
| `minuteStep` | `number` | `1` |
| `secondStep` | `number` | `1` |

| Model | Type |
|-------|------|
| `value` | `Date \| null` |

```html
<ui-datetimepicker label="Event" [(value)]="eventDate" [clearable]="true" />
```

---

## File Chooser

**Selector:** `ui-file-chooser`

| Input | Type | Default |
|-------|------|---------|
| `variant` | `'default' \| 'compact' \| 'minimal'` | `'default'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `accept` | `string` | `''` |
| `multiple` | `boolean` | `false` |
| `disabled` | `boolean` | `false` |
| `maxFileSize` | `number \| null` | `null` (bytes) |
| `maxFiles` | `number \| null` | `null` |
| `showFileList` | `boolean` | `true` |
| `showPreviews` | `boolean` | `true` |
| `dropzoneText` | `string` | `'Drag and drop files here'` |
| `browseText` | `string` | `'or click to browse'` |
| `acceptHint` | `string` | `''` |
| `error` | `string` | `''` |

| Model | Type |
|-------|------|
| `value` | `File[]` |

| Output | Type |
|--------|------|
| `fileAdded` | `File` |
| `fileRemoved` | `File` |
| `filesRejected` | `{ file: File; reason: string }[]` |

```html
<ui-file-chooser
  [(value)]="files"
  accept="image/*"
  [multiple]="true"
  [maxFileSize]="5242880"
  [maxFiles]="3"
/>
```

---

## Template Input

**Selector:** `ui-template-input`

| Input | Type | Default |
|-------|------|---------|
| `label` | `string` | `''` |
| `placeholder` | `string` | `''` |
| `hint` | `string` | `''` |
| `error` | `string` | `''` |
| `disabled` | `boolean` | `false` |
| `readonly` | `boolean` | `false` |
| `required` | `boolean` | `false` |
| `id` | `string` | `''` |

| Model | Type |
|-------|------|
| `value` | `string` |
| `variables` | `TemplateVariable[]` |

| Output | Type |
|--------|------|
| `variableHover` | `string \| null` |

**TemplateVariable:** `{ key: string; value: string }`

Highlights `{{variable}}` patterns in the input — green for resolved, amber for unset, red for unknown.

```html
<ui-template-input
  label="Message template"
  [(value)]="template"
  [(variables)]="vars"
  placeholder="Hello {{name}}, your order {{orderId}} is ready"
/>
```

---

## Badge

**Selector:** `ui-badge`

| Input | Type | Default |
|-------|------|---------|
| `variant` | `'default' \| 'primary' \| 'success' \| 'warning' \| 'danger' \| 'info'` | `'default'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `rounded` | `boolean` | `false` |
| `removable` | `boolean` | `false` |

| Output | Type |
|--------|------|
| `removed` | `void` |

```html
<ui-badge variant="success">Active</ui-badge>
<ui-badge variant="danger" [removable]="true" (removed)="removeTag()">Error</ui-badge>
```

---

## Alert

**Selector:** `ui-alert`

| Input | Type | Default |
|-------|------|---------|
| `variant` | `'info' \| 'success' \| 'warning' \| 'danger'` | `'info'` |
| `title` | `string` | `''` |
| `dismissible` | `boolean` | `false` |
| `showIcon` | `boolean` | `true` |

| Output | Type |
|--------|------|
| `dismissed` | `void` |

```html
<ui-alert variant="warning" title="Warning" [dismissible]="true">
  Check your input before continuing.
</ui-alert>
```

---

## Card

**Selector:** `ui-card`

| Input | Type | Default |
|-------|------|---------|
| `variant` | `'default' \| 'outlined' \| 'elevated'` | `'default'` |
| `padding` | `'none' \| 'sm' \| 'md' \| 'lg'` | `'md'` |
| `clickable` | `boolean` | `false` |

| Output | Type |
|--------|------|
| `clicked` | `void` |

```html
<ui-card variant="elevated" padding="lg">
  <h3>Card Title</h3>
  <p>Card content goes here.</p>
</ui-card>
```

---

## Spinner

**Selector:** `ui-spinner`

| Input | Type | Default |
|-------|------|---------|
| `size` | `'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'` |
| `variant` | `'primary' \| 'secondary' \| 'white'` | `'primary'` |

```html
<ui-spinner size="lg" variant="primary" />
```

---

## Progress

**Selector:** `ui-progress`

| Input | Type | Default |
|-------|------|---------|
| `value` | `number` | `0` (0–100) |
| `variant` | `'primary' \| 'success' \| 'warning' \| 'danger'` | `'primary'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `showLabel` | `boolean` | `false` |
| `indeterminate` | `boolean` | `false` |
| `striped` | `boolean` | `false` |
| `animated` | `boolean` | `false` |

```html
<ui-progress [value]="75" variant="success" [showLabel]="true" [striped]="true" [animated]="true" />
```

---

## Circular Progress

**Selector:** `ui-circular-progress`

| Input | Type | Default |
|-------|------|---------|
| `value` | `number` | `0` (0–100) |
| `variant` | `'primary' \| 'success' \| 'warning' \| 'danger'` | `'primary'` |
| `size` | `'xs' \| 'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'` |
| `strokeWidth` | `number` | `4` |
| `showLabel` | `boolean` | `false` |
| `indeterminate` | `boolean` | `false` |

```html
<ui-circular-progress [value]="60" [showLabel]="true" variant="success" />
```

---

## Pagination

**Selector:** `ui-pagination`

| Input | Type | Default |
|-------|------|---------|
| `total` | `number` | required |
| `pageSize` | `number` | `10` |
| `maxPages` | `number` | `5` |
| `showFirstLast` | `boolean` | `true` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |

| Model | Type |
|-------|------|
| `page` | `number` (default `1`) |

```html
<ui-pagination [total]="250" [pageSize]="20" [(page)]="currentPage" />
```

---

## Tabs

**Selectors:** `ui-tabs`, `ui-tab`

### Tabs

| Input | Type | Default |
|-------|------|---------|
| `variant` | `'default' \| 'pills' \| 'underline'` | `'default'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `ariaLabel` | `string` | `''` |
| `renderMode` | `'conditional' \| 'persistent'` | `'conditional'` |

| Model | Type |
|-------|------|
| `activeTab` | `string \| number` (default `0`) |

### Tab

| Input | Type | Default |
|-------|------|---------|
| `id` | `string \| number` | `''` |
| `label` | `string` | required |
| `disabled` | `boolean` | `false` |

Supports `TabIconDirective` for custom icon templates.

```html
<ui-tabs variant="underline" [(activeTab)]="activeTab">
  <ui-tab label="Overview" id="overview">Overview content</ui-tab>
  <ui-tab label="Settings" id="settings">Settings content</ui-tab>
  <ui-tab label="Disabled" [disabled]="true">Disabled content</ui-tab>
</ui-tabs>
```

---

## Dynamic Tabs

**Selector:** `ui-dynamic-tabs`

Same inputs as Tabs. Manages tabs programmatically via `TabsService`:

| Input | Type | Default |
|-------|------|---------|
| `variant` | `'default' \| 'pills' \| 'underline'` | `'default'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `ariaLabel` | `string` | `''` |
| `renderMode` | `'conditional' \| 'persistent'` | `'conditional'` |

Tabs are added/removed programmatically. Each dynamic tab component receives `TAB_DATA` and `TAB_REF` tokens.

---

## Accordion

**Selectors:** `ui-accordion`, `ui-accordion-item`

### Accordion

| Input | Type | Default |
|-------|------|---------|
| `multi` | `boolean` | `false` |
| `variant` | `'default' \| 'bordered' \| 'separated'` | `'default'` |

### AccordionItem

| Input | Type | Default |
|-------|------|---------|
| `header` | `string` | `''` |
| `disabled` | `boolean` | `false` |
| `expanded` | `boolean` | `false` |

Supports `AccordionHeaderDirective` for custom header templates.
Methods: `toggle()`, `expand()`, `collapse()`

```html
<ui-accordion variant="bordered" [multi]="true">
  <ui-accordion-item header="Section 1" [expanded]="true">Content 1</ui-accordion-item>
  <ui-accordion-item header="Section 2">Content 2</ui-accordion-item>
</ui-accordion>
```

---

## Table

**Selector:** `ui-table`

| Input | Type | Default |
|-------|------|---------|
| `data` | `T[]` | `[]` |
| `columns` | `TableColumn<T>[]` | `[]` |
| `trackByFn` | `(item: T) => unknown` | identity |

**TableColumn:** `{ key: string; header: string; sortable?: boolean; width?: string }`
**SortState:** `{ column: string | null; direction: 'asc' | 'desc' | null }`

Supports custom cell templates via `CellTemplateDirective` (`uiCellTemplate`).

```html
<ui-table [data]="users" [columns]="columns">
  <ng-template uiCellTemplate="actions" let-row>
    <ui-button size="sm" (clicked)="edit(row)">Edit</ui-button>
  </ng-template>
</ui-table>
```

```typescript
columns: TableColumn<User>[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'email', header: 'Email', sortable: true },
  { key: 'actions', header: 'Actions' },
];
```

---

## Dropdown

**Selectors:** `ui-dropdown`, `ui-dropdown-item`, `ui-dropdown-divider`

### Dropdown

| Input | Type | Default |
|-------|------|---------|
| `position` | `'bottom-start' \| 'bottom-end' \| 'top-start' \| 'top-end'` | `'bottom-start'` |
| `closeOnSelect` | `boolean` | `true` |
| `matchTriggerWidth` | `boolean` | `false` |

Methods: `toggle()`, `open()`, `openAt(x, y)`, `close()`

### DropdownItem

| Input | Type | Default |
|-------|------|---------|
| `disabled` | `boolean` | `false` |
| `icon` | `string` | `''` |

| Output | Type |
|--------|------|
| `clicked` | `void` |

```html
<ui-dropdown>
  <button uiDropdownTrigger>Options</button>
  <ui-dropdown-item (clicked)="edit()">Edit</ui-dropdown-item>
  <ui-dropdown-item (clicked)="duplicate()">Duplicate</ui-dropdown-item>
  <ui-dropdown-divider />
  <ui-dropdown-item (clicked)="delete()">Delete</ui-dropdown-item>
</ui-dropdown>
```

---

## Tooltip

**Selector:** `[uiTooltip]` (directive)

| Input | Type | Default |
|-------|------|---------|
| `uiTooltip` | `string` | required |
| `tooltipPosition` | `'top' \| 'bottom' \| 'left' \| 'right'` | `'top'` |
| `tooltipDelay` | `number` (ms) | `200` |
| `tooltipDisabled` | `boolean` | `false` |

```html
<ui-button uiTooltip="Save your changes" tooltipPosition="bottom">Save</ui-button>
```

---

## Tree

**Selectors:** `ui-tree`, `ui-tree-node`

| Input | Type | Default |
|-------|------|---------|
| `nodes` | `TreeNode[]` | `[]` |
| `indent` | `number` (px) | `16` |
| `draggable` | `boolean` | `false` |

| Output | Type |
|--------|------|
| `nodeClick` | `TreeNode` |
| `nodeExpand` | `TreeNode` |
| `nodeCollapse` | `TreeNode` |
| `nodeDrop` | `TreeNodeDropEvent` |

**TreeNode:** `{ label: string; icon?: string; expanded?: boolean; children?: TreeNode[]; data?: any }`
**TreeNodeDropEvent:** `{ node: TreeNode; target: TreeNode; position: 'before' | 'after' | 'inside' }`

```html
<ui-tree [nodes]="treeData" [draggable]="true" (nodeClick)="onNodeClick($event)" />
```

---

## Split Panes

**Selectors:** `ui-split`, `ui-split-pane`

### Split

| Input | Type | Default |
|-------|------|---------|
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` |
| `gutterSize` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `disabled` | `boolean` | `false` |

| Output | Type |
|--------|------|
| `sizeChange` | `{ gutterIndex: number; sizes: number[] }` |
| `dragStart` | `number` |
| `dragEnd` | `number` |

### SplitPane

| Input | Type | Default |
|-------|------|---------|
| `size` | `number \| undefined` | auto |
| `minSize` | `number` | `0` |
| `maxSize` | `number` | `100` |

```html
<ui-split orientation="horizontal">
  <ui-split-pane [size]="30" [minSize]="20">Left panel</ui-split-pane>
  <ui-split-pane [size]="70" [minSize]="30">Right panel</ui-split-pane>
</ui-split>
```

---

## Modal

**Selector:** `ui-modal`

Used inside dialog components (opened via `DialogService`).

| Input | Type | Default |
|-------|------|---------|
| `title` | `string` | `''` |
| `size` | `'sm' \| 'md' \| 'lg' \| 'xl' \| 'full'` | `'md'` |
| `width` | `string` | `''` |
| `maxWidth` | `string` | `''` |
| `closeOnBackdropClick` | `boolean` | `true` |
| `closeOnEscape` | `boolean` | `true` |
| `showCloseButton` | `boolean` | `true` |
| `panelClass` | `string` | `''` |

Content projection slots: default (body), `footer`.

---

## Layout (Shell)

**Selectors:** `ui-shell`, `ui-navbar`, `ui-sidebar`, `ui-content`, `ui-footer`, `ui-sidebar-toggle`

### Shell

| Input | Type | Default |
|-------|------|---------|
| `variant` | `'default' \| 'header' \| 'simple'` | `'default'` |

```html
<ui-shell variant="default">
  <ui-navbar>
    <ui-sidebar-toggle />
    <h1>My App</h1>
  </ui-navbar>
  <ui-sidebar>
    <nav>Sidebar navigation</nav>
  </ui-sidebar>
  <ui-content>
    <p>Main content</p>
  </ui-content>
  <ui-footer>Footer</ui-footer>
</ui-shell>
```

---

## Dialog Service

**Import:** `DialogService`, `DialogRef`, `DIALOG_DATA`, `DIALOG_REF`

### Opening a dialog

```typescript
const ref = this.dialogService.open<MyDialog, MyData, MyResult>(MyDialog, {
  data: { title: 'Confirm', message: 'Are you sure?' },
  size: 'sm',           // 'sm' | 'md' | 'lg' | 'xl' | 'full'
  width: '500px',       // overrides size
  maxWidth: '90vw',
  closeOnBackdropClick: true,
  closeOnEscape: true,
  panelClass: 'my-dialog',
});

const result = await ref.afterClosed(); // Promise<MyResult | undefined>
```

### Dialog component pattern

```typescript
@Component({
  selector: 'app-confirm',
  standalone: true,
  imports: [ModalComponent, ButtonComponent],
  template: `
    <ui-modal [title]="data.title" size="sm">
      <p>{{ data.message }}</p>
      <ng-container footer>
        <ui-button color="secondary" (clicked)="dialogRef.close(false)">Cancel</ui-button>
        <ui-button color="primary" (clicked)="dialogRef.close(true)">Confirm</ui-button>
      </ng-container>
    </ui-modal>
  `,
})
export class ConfirmDialog {
  readonly dialogRef = inject(DIALOG_REF) as DialogRef<boolean>;
  readonly data = inject(DIALOG_DATA) as { title: string; message: string };
}
```

---

## Toast Service

**Import:** `ToastService`, `ToastRef`

### Shorthand methods

```typescript
toastService.success('Saved successfully!', 'Success');
toastService.error('Something went wrong.', 'Error');
toastService.warning('Check your input.');
toastService.info('New update available.');
```

### Full config

```typescript
const ref: ToastRef = toastService.show({
  message: 'Operation complete',
  title: 'Done',                        // optional
  variant: 'success',                   // 'success' | 'error' | 'warning' | 'info' (default: 'info')
  duration: 5000,                       // ms, 0 = persistent (default: 5000)
  position: 'top-right',               // 'top-right' | 'top-left' | 'top-center' | 'bottom-right' | 'bottom-left' | 'bottom-center'
  dismissible: true,                    // show close button (default: true)
  showProgress: true,                   // progress bar (default: true)
  maxVisible: 3,                        // oldest auto-dismissed (default: 3, 0 = unlimited)
});

ref.dismiss();              // dismiss programmatically
toastService.dismissAll();  // dismiss all
```

---

## Loading Service

**Import:** `LoadingService`, `LoadingDirective`, `LOADABLE`, `Loadable`

### Service usage

```typescript
loadingService.start('save');               // start loading
loadingService.stop('save');                // stop loading
loadingService.toggle('save');              // toggle
loadingService.set('save', true);           // set explicitly
loadingService.isLoading('save');           // Signal<boolean>
loadingService.isAnyLoading();              // Signal<boolean>
loadingService.clear('save');               // remove entry
loadingService.clearAll();                  // clear all
```

### Directive usage

```html
<ui-button [uiLoading]="'save'">Save</ui-button>
```

The directive automatically calls `setLoading()` on components implementing the `Loadable` interface (provided via `LOADABLE` token).

---

## Sidebar Service

**Import:** `SidebarService`

| Signal | Type | Description |
|--------|------|-------------|
| `collapsed` | `Signal<boolean>` | Desktop sidebar collapsed |
| `mobileOpen` | `Signal<boolean>` | Mobile sidebar open |
| `isMobile` | `Signal<boolean>` | Viewport < 768px |

| Method | Description |
|--------|-------------|
| `toggle()` | Toggle collapsed (desktop) or mobileOpen (mobile) |
| `expand()` | Expand sidebar |
| `collapse()` | Collapse sidebar |
| `openMobile()` | Open mobile sidebar |
| `closeMobile()` | Close mobile sidebar |

---

## CSS Variables

Override these at `:root` or on any container to theme the library.

### Colors — Primary

| Variable | Default |
|----------|---------|
| `--ui-primary` | `#3b82f6` |
| `--ui-primary-hover` | `#2563eb` |
| `--ui-primary-active` | `#1d4ed8` |
| `--ui-primary-text` | `#ffffff` |

### Colors — Secondary

| Variable | Default |
|----------|---------|
| `--ui-secondary` | `#64748b` |
| `--ui-secondary-hover` | `#475569` |
| `--ui-secondary-active` | `#334155` |
| `--ui-secondary-text` | `#ffffff` |

### Colors — Success

| Variable | Default |
|----------|---------|
| `--ui-success` | `#22c55e` |
| `--ui-success-hover` | `#16a34a` |
| `--ui-success-active` | `#15803d` |
| `--ui-success-text` | `#ffffff` |

### Colors — Danger

| Variable | Default |
|----------|---------|
| `--ui-danger` | `#ef4444` |
| `--ui-danger-hover` | `#dc2626` |
| `--ui-danger-active` | `#b91c1c` |
| `--ui-danger-text` | `#ffffff` |

### Colors — Warning

| Variable | Default |
|----------|---------|
| `--ui-warning` | `#f59e0b` |
| `--ui-warning-hover` | `#d97706` |
| `--ui-warning-active` | `#b45309` |
| `--ui-warning-text` | `#ffffff` |

### Backgrounds

| Variable | Default |
|----------|---------|
| `--ui-bg` | `#ffffff` |
| `--ui-bg-secondary` | `#f8fafc` |
| `--ui-bg-tertiary` | `#f1f5f9` |
| `--ui-bg-hover` | `rgba(0, 0, 0, 0.05)` |

### Text

| Variable | Default |
|----------|---------|
| `--ui-text` | `#1e293b` |
| `--ui-text-muted` | `#64748b` |
| `--ui-text-disabled` | `#94a3b8` |

### Borders

| Variable | Default |
|----------|---------|
| `--ui-border` | `#e2e8f0` |
| `--ui-border-hover` | `#cbd5e1` |
| `--ui-border-focus` | `var(--ui-primary)` |

### Border Radius

| Variable | Default |
|----------|---------|
| `--ui-radius-sm` | `0.25rem` |
| `--ui-radius-md` | `0.375rem` |
| `--ui-radius-lg` | `0.5rem` |
| `--ui-radius-xl` | `0.75rem` |

### Spacing

| Variable | Default |
|----------|---------|
| `--ui-spacing-xs` | `0.25rem` |
| `--ui-spacing-sm` | `0.5rem` |
| `--ui-spacing-md` | `1rem` |
| `--ui-spacing-lg` | `1.5rem` |
| `--ui-spacing-xl` | `2rem` |

### Shadows

| Variable | Default |
|----------|---------|
| `--ui-shadow-sm` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` |
| `--ui-shadow-md` | `0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)` |
| `--ui-shadow-lg` | `0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)` |

### Transitions

| Variable | Default |
|----------|---------|
| `--ui-transition-fast` | `150ms ease` |
| `--ui-transition-normal` | `200ms ease` |
| `--ui-transition-slow` | `300ms ease` |

### Font Sizes

| Variable | Default |
|----------|---------|
| `--ui-font-xs` | `0.75rem` |
| `--ui-font-sm` | `0.875rem` |
| `--ui-font-md` | `1rem` |
| `--ui-font-lg` | `1.125rem` |
| `--ui-font-xl` | `1.25rem` |

### Layout Dimensions

| Variable | Default |
|----------|---------|
| `--ui-sidebar-width` | `16rem` |
| `--ui-sidebar-collapsed-width` | `4rem` |
| `--ui-navbar-height` | `4rem` |
| `--ui-footer-height` | `3rem` |
| `--ui-breakpoint-mobile` | `768px` |

### Dropdown / Select

| Variable | Default |
|----------|---------|
| `--ui-dropdown-bg` | `var(--ui-bg)` |
| `--ui-dropdown-border` | `var(--ui-border)` |
| `--ui-dropdown-shadow` | `var(--ui-shadow-lg)` |
| `--ui-dropdown-radius` | `var(--ui-radius-md)` |
| `--ui-dropdown-max-height` | `300px` |
| `--ui-option-hover-bg` | `var(--ui-bg-hover)` |
| `--ui-option-selected-bg` | `color-mix(in srgb, var(--ui-primary) 10%, transparent)` |
| `--ui-option-selected-text` | `var(--ui-primary)` |

### Theming example

```css
:root {
  --ui-primary: #8b5cf6;
  --ui-primary-hover: #7c3aed;
  --ui-primary-active: #6d28d9;
  --ui-bg: #0f172a;
  --ui-bg-secondary: #1e293b;
  --ui-text: #f1f5f9;
  --ui-text-muted: #94a3b8;
  --ui-border: #334155;
  --ui-border-hover: #475569;
  --ui-radius-md: 0.5rem;
}
```
