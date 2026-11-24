import { Fragment } from 'react'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { useUiStore } from '../../store/uiStore'
import { loadSampleTrip } from '../io/importTrip'
import { useEditingLocked } from '../ride/rideStore'
import { shortcutSections } from './shortcutList'
import { HELP_DIALOG_ID } from './helpActions'
import './help.css'

/** Short how-tos, in the order someone builds a trip. */
const TOPICS: { id: string; title: string; items: string[] }[] = [
  {
    id: 'places',
    title: 'Add and arrange places',
    items: [
      'Type a place in the “Add a place…” box under the list and press Enter, then pick a result. Or right-click (long-press on a phone) the map and choose “Add place here”; “Insert place here” puts it into the route where you clicked.',
      'Drag a place by its grip (⋮⋮) to reorder, or drag its marker on the map to move it. Click a place to change its location with a new search, rename it, or add a note.',
      'The number on the right of each place is its day of travel. Places on the same day are driven the same day; leave gaps for rest days. The trip’s length, the ride and the dates all follow these numbers.',
    ],
  },
  {
    id: 'routes',
    title: 'Shape the route',
    items: [
      'Drive legs follow the roads. Drag the line anywhere to bend it through a point (a “via point”), the way you would in Google Maps; the via point only shows as a round handle while you point at the line, so the route stays clean; double-click or right-click the handle to remove it.',
      'Click the connector between two places to open its leg editor: switch to a ferry, train or flight leg (hand-drawn, with a time estimate), turn off “Follow roads” for a straight line, set the travel time or label it, or reset the shape.',
    ],
  },
  {
    id: 'show',
    title: 'Show it',
    items: [
      'The card on the map shows the title, dates, distance, driving time and the countries you pass. Click the title to edit it.',
      'Ride plays the trip as a little vehicle driving day by day; Space pauses it and the arrow keys jump between days.',
      'Choose the vehicle with the arrow next to Ride: a campervan, a black Iveco Daily, a retro bus, a motorhome, a car with a caravan or a 4×4 with a roof tent, most of them in a colour of your choice. It is part of the trip, so it is saved and shared with it, and new trips start with the vehicle you chose last. You cannot change it while a ride runs or in presentation mode.',
      'Presentation mode (P) hides the sidebar and every editing tool, which is what you want for showing a trip to others. Esc leaves it.',
      'Export image (the picture button in the top bar) makes a PNG of the whole trip: pick a size (landscape, portrait, square or A4 print), choose what to show on it, check the preview, then download it or copy it. The map’s OpenStreetMap credit is not drawn on the picture unless you choose “Small, in the image”: post the caption shown under the preview (it has its own Copy button) with the picture. It works in presentation mode too.',
    ],
  },
  {
    id: 'save',
    title: 'Save and share',
    items: [
      'Your trip is saved in this browser automatically. File → Save as JSON downloads it as a file; File → Open trip file (or dropping the file on the page) brings it back.',
      'File → Copy share link puts the whole trip into a link; “Copy presentation link” makes one that opens in presentation mode. Anything you replace stays under File → Recent trips.',
    ],
  },
]

/** The Help dialog: how to do the main things, then every keyboard shortcut. Opened by the top bar's "?" button or the `?` key. */
export function HelpDialog() {
  const open = useUiStore((s) => s.openDialogId === HELP_DIALOG_ID)
  // The sample replaces the trip: not while presenting or riding.
  const locked = useEditingLocked()
  const close = () => {
    const ui = useUiStore.getState()
    if (ui.openDialogId === HELP_DIALOG_ID) ui.closeDialog()
  }
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Help"
      description="Roadmap Overview sketches a campervan trip on a map: places, the route between them, and a picture to share."
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            disabled={locked}
            onClick={() => {
              close()
              void loadSampleTrip()
            }}
          >
            Load the sample trip
          </Button>
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </>
      }
    >
      <div className="help" data-testid="help-dialog">
        {TOPICS.map((topic) => (
          <section key={topic.id} className="help__section" aria-labelledby={`help-${topic.id}`}>
            <h3 id={`help-${topic.id}`} className="help__heading">
              {topic.title}
            </h3>
            <ul className="help__list">
              {topic.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}

        <section className="help__section" aria-labelledby="help-shortcuts">
          <h3 id="help-shortcuts" className="help__heading">
            Keyboard shortcuts
          </h3>
          {shortcutSections().map((section) => (
            <table key={section.id} className="help__keys" data-testid={`help-keys-${section.id}`}>
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
                              <kbd key={key}>{key}</kbd>
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
          ))}
        </section>
      </div>
    </Dialog>
  )
}
