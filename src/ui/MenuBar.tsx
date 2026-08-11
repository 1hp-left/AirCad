import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ExportFormat } from '../three/exporter';
import { PRIMITIVE_LABELS, PRIMITIVE_TYPES, type PrimitiveType } from '../three/primitives';

type MenuId = 'file' | 'edit' | 'add' | 'view';

interface MenuBarProps {
  exportDisabled: boolean;
  sceneCommandsDisabled: boolean;
  canDelete: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasObjects: boolean;
  hasSelection: boolean;
  gridVisible: boolean;
  axesVisible: boolean;
  cameraVisible: boolean;
  assistantVisible: boolean;
  voiceVisible: boolean;
  onExport: (format: ExportFormat) => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAdd: (primitive: PrimitiveType) => void;
  onFrameSelected: () => void;
  onFrameAll: () => void;
  onResetView: () => void;
  onToggleGrid: () => void;
  onToggleAxes: () => void;
  onToggleCamera: () => void;
  onToggleAssistant: () => void;
  onToggleVoice: () => void;
}

interface MenuItemProps {
  children: ReactNode;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
}

export function MenuBar(props: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const menuButton = (id: MenuId, label: string) => (
    <button
      type="button"
      className={`app-menu-button ${openMenu === id ? 'is-open' : ''}`}
      aria-haspopup="menu"
      aria-expanded={openMenu === id}
      onClick={() => setOpenMenu((current) => current === id ? null : id)}
      onPointerEnter={() => {
        if (openMenu) setOpenMenu(id);
      }}
    >
      {label}
    </button>
  );

  const closeThen = (action: () => void) => () => {
    setOpenMenu(null);
    action();
  };

  return (
    <nav className="app-menu-bar" aria-label="Application menus" ref={rootRef}>
      <div className="app-menu">
        {menuButton('file', 'File')}
        {openMenu === 'file' && (
          <div className="app-menu-popover" role="menu">
            <MenuItem disabled={props.exportDisabled} onSelect={closeThen(() => props.onExport('stl'))}>Export STL</MenuItem>
            <MenuItem disabled={props.exportDisabled} onSelect={closeThen(() => props.onExport('obj'))}>Export OBJ</MenuItem>
            <MenuItem disabled={props.exportDisabled} onSelect={closeThen(() => props.onExport('glb'))}>Export GLB</MenuItem>
          </div>
        )}
      </div>
      <div className="app-menu">
        {menuButton('edit', 'Edit')}
        {openMenu === 'edit' && (
          <div className="app-menu-popover" role="menu">
            <MenuItem shortcut="Ctrl Z" disabled={!props.canUndo} onSelect={closeThen(props.onUndo)}>Undo</MenuItem>
            <MenuItem shortcut="Ctrl Y" disabled={!props.canRedo} onSelect={closeThen(props.onRedo)}>Redo</MenuItem>
            <div className="app-menu-separator" />
            <MenuItem shortcut="Del" disabled={!props.canDelete} danger onSelect={closeThen(props.onDelete)}>Delete selected</MenuItem>
          </div>
        )}
      </div>
      <div className="app-menu">
        {menuButton('add', 'Add')}
        {openMenu === 'add' && (
          <div className="app-menu-popover" role="menu">
            {PRIMITIVE_TYPES.map((primitive) => (
              <MenuItem key={primitive} disabled={props.sceneCommandsDisabled} onSelect={closeThen(() => props.onAdd(primitive))}>
                {PRIMITIVE_LABELS[primitive]}
              </MenuItem>
            ))}
          </div>
        )}
      </div>
      <div className="app-menu">
        {menuButton('view', 'View')}
        {openMenu === 'view' && (
          <div className="app-menu-popover app-menu-view" role="menu">
            <MenuItem shortcut="Numpad ." disabled={!props.hasSelection} onSelect={closeThen(props.onFrameSelected)}>Frame selected</MenuItem>
            <MenuItem shortcut="Home" disabled={!props.hasObjects} onSelect={closeThen(props.onFrameAll)}>Frame all</MenuItem>
            <MenuItem shortcut="Shift C" onSelect={closeThen(props.onResetView)}>Reset view</MenuItem>
            <div className="app-menu-separator" />
            <MenuItem checked={props.gridVisible} onSelect={closeThen(props.onToggleGrid)}>Show grid</MenuItem>
            <MenuItem checked={props.axesVisible} onSelect={closeThen(props.onToggleAxes)}>Show axes</MenuItem>
            <MenuItem checked={props.cameraVisible} onSelect={closeThen(props.onToggleCamera)}>Camera preview</MenuItem>
            <div className="app-menu-separator" />
            <MenuItem checked={props.assistantVisible} onSelect={closeThen(props.onToggleAssistant)}>Assistant panel</MenuItem>
            <MenuItem shortcut="Ctrl Shift Space" checked={props.voiceVisible} onSelect={closeThen(props.onToggleVoice)}>Voice control</MenuItem>
          </div>
        )}
      </div>
    </nav>
  );
}

function MenuItem({
  children,
  shortcut,
  checked,
  disabled,
  danger,
  onSelect,
}: MenuItemProps) {
  return (
    <button
      type="button"
      className={`app-menu-item ${danger ? 'is-danger' : ''}`}
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked === undefined ? undefined : checked}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="app-menu-check" aria-hidden="true">{checked ? '✓' : ''}</span>
      <span>{children}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}
