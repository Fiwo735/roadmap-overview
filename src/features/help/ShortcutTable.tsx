import { Fragment } from 'react'
import type { ShortcutSection } from './shortcutList'
import './help.css'

/**
 * One section of `shortcutSections()` as a table of keys and what they do. The Help dialog and the top bar's
 * keyboard popover both draw their rows with this, so the list is written once (`shortcutList.ts`) and looks alike.
 */
export function ShortcutTable({ section, testId, compact = false }: { section: ShortcutSection; testId: string; compact?: boolean }) {
  return (
    <table className={compact ? 'help__keys help__keys--compact' : 'help__keys'} data-testid={testId}>
      <caption>{section.title}</caption>
      <tbody>
        {section.entries.map((entry) => (
          <tr key={entry.does + entry.keys.join()}>
            <th scope="row">
              {entry.keys.map((combo, i) => (
                <Fragment key={combo.join('+')}>
                  {i > 0 ? <span className="help__or"> or </span> : null}
                  <span className="help__combo">
                    {combo.map((key) => (
                      <kbd key={key} className="kbd">
                        {key}
                      </kbd>
                    ))}
                  </span>
                </Fragment>
              ))}
            </th>
            <td>{entry.does}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
