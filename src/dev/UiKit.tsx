// Dev-only page body (/ui-kit.html): every shared component in one place, for eyeballing and for
// e2e/components.spec.ts. Not part of the production build.
import { useState, type ReactNode } from 'react'
import { Copy, Download, FolderOpen, Plus, Settings, Trash2 } from 'lucide-react'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { IconButton } from '../components/IconButton'
import { Menu, type MenuEntry } from '../components/Menu'
import { SegmentedControl } from '../components/SegmentedControl'
import { Spinner } from '../components/Spinner'
import { Switch } from '../components/Switch'
import { ToastHost } from '../components/Toast'
import { toast } from '../components/toast'
import { ThemeToggle } from '../features/theme/ThemeToggle'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>{children}</div>
    </section>
  )
}

export function UiKit() {
  const [dialog, setDialog] = useState(false)
  const [mode, setMode] = useState('drive')
  const [last, setLast] = useState('')
  const [segment, setSegment] = useState<'drive' | 'ferry' | 'train'>('drive')
  const [follow, setFollow] = useState(true)

  const items: MenuEntry[] = [
    { id: 'open', label: 'Open trip…', icon: <FolderOpen size={16} />, shortcut: 'Ctrl+O', onSelect: () => setLast('open') },
    { id: 'save', label: 'Save to file', icon: <Download size={16} />, onSelect: () => setLast('save') },
    { id: 'copy', label: 'Copy share link', icon: <Copy size={16} />, disabled: true, onSelect: () => setLast('copy') },
    { id: 's1', type: 'separator' },
    ...(['drive', 'ferry', 'train'] as const).map((m) => ({
      id: `mode-${m}`,
      label: m[0].toUpperCase() + m.slice(1),
      checked: mode === m,
      onSelect: () => setMode(m),
    })),
    { id: 's2', type: 'separator' },
    { id: 'new', label: 'New trip', icon: <Trash2 size={16} />, danger: true, onSelect: () => setLast('new') },
  ]

  return (
    <main style={{ display: 'grid', gap: 32, padding: 32, maxWidth: 900 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 20 }}>UI kit</h1>
        <ThemeToggle />
      </header>

      <Section title="Buttons">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="primary" icon={<Plus size={16} />}>
          With icon
        </Button>
        <Button variant="primary" loading>
          Loading
        </Button>
        <Button variant="secondary" disabled>
          Disabled
        </Button>
        <Button variant="primary" size="sm">
          Small
        </Button>
        <Button variant="primary" size="lg">
          Large
        </Button>
      </Section>

      <Section title="Icon buttons (hover for the tooltip)">
        <IconButton label="Settings" icon={<Settings size={18} />} />
        <IconButton label="Add stop" tooltip="Add a stop (A)" icon={<Plus size={18} />} variant="secondary" />
        <IconButton label="Delete" icon={<Trash2 size={16} />} size="sm" />
        <IconButton label="Unavailable" icon={<Download size={18} />} disabled />
      </Section>

      <Section title="Menu">
        <Menu
          label="File"
          items={items}
          trigger={(props) => (
            <Button {...props} variant="secondary">
              File
            </Button>
          )}
        />
        <Menu
          label="More"
          align="end"
          items={items.slice(0, 2)}
          trigger={(props) => <IconButton {...props} label="More actions" icon={<Settings size={18} />} />}
        />
        <span data-testid="menu-last">{last}</span>
        <span data-testid="menu-mode">{mode}</span>
      </Section>

      <Section title="Segmented control and switch">
        <div style={{ width: 260 }}>
          <SegmentedControl
            label="Travel mode"
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'drive', label: 'Drive' },
              { value: 'ferry', label: 'Ferry', color: '#0891b2' },
              { value: 'train', label: 'Train' },
            ]}
          />
        </div>
        <span data-testid="segment-value">{segment}</span>
        <Switch checked={follow} onChange={setFollow} data-testid="kit-switch">
          Follow roads
        </Switch>
        <Switch checked={false} onChange={() => undefined} disabled>
          Unavailable
        </Switch>
      </Section>

      <Section title="Dialog">
        <Button variant="primary" onClick={() => setDialog(true)}>
          Open dialog
        </Button>
        <Dialog
          open={dialog}
          onClose={() => setDialog(false)}
          title="Start a new trip?"
          description="Your current trip stays available through undo."
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => setDialog(false)}>
                Start new trip
              </Button>
            </>
          }
        >
          <p>Places, legs and the title will be cleared.</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <Button size="sm" onClick={() => toast.info('Toast from inside the dialog')}>
              Toast from dialog
            </Button>
            <Menu
              label="Dialog options"
              items={items.slice(0, 2)}
              trigger={(props) => (
                <Button {...props} size="sm">
                  Options
                </Button>
              )}
            />
            <IconButton label="Dialog help" icon={<Settings size={16} />} size="sm" />
          </div>
        </Dialog>
      </Section>

      <Section title="Toasts and spinner">
        <Button onClick={() => toast.info('Route copied to the clipboard.')}>Info</Button>
        <Button onClick={() => toast.success('Trip saved.')}>Success</Button>
        <Button onClick={() => toast.error('Routing failed: no road connection between these places.')}>Error</Button>
        <Button onClick={() => toast.info('Place removed.', { action: { label: 'Undo', onClick: () => setLast('undone') } })}>
          With action
        </Button>
        <Spinner size={24} label="Loading" />
      </Section>

      <ToastHost />
    </main>
  )
}
