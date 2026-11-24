import { create } from 'zustand'
import { useUiStore } from '../../store/uiStore'

/** The dialog behind the top bar's export button holds two exports, an image and a video (F13). */
export const EXPORT_DIALOG_ID = 'export-image'

export type ExportTab = 'image' | 'video'

interface ExportTabState {
  tab: ExportTab
  /** An export is being made: the other tab stays where it is until it is done (switching would stop it). */
  busy: boolean
  /** Where the focus goes when the dialog closes, when it was not the top bar's button that opened it. */
  returnFocusTo: HTMLElement | null
}

export const useExportTab = create<ExportTabState>()(() => ({ tab: 'image', busy: false, returnFocusTo: null }))

export const setExportTab = (tab: ExportTab): void => useExportTab.setState({ tab })
export const setExportBusy = (busy: boolean): void => useExportTab.setState({ busy })

/** Open the export dialog on `tab`; `opener` is what gets the focus back when it closes (default: the top bar's button). */
export function openExportDialog(tab: ExportTab, opener?: HTMLElement | null): void {
  useExportTab.setState({ tab, busy: false, returnFocusTo: opener ?? null })
  useUiStore.getState().openDialog(EXPORT_DIALOG_ID)
}
