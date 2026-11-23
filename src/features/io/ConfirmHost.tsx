import { useEffect, useRef } from 'react'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { useConfirmStore } from './confirm'

/** The dialog behind `askToConfirm`. The safe answer (Cancel) has the focus. */
export function ConfirmHost() {
  const request = useConfirmStore((s) => s.request)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (request) cancelRef.current?.focus()
  }, [request])

  const answer = (confirmed: boolean) => {
    request?.resolve(confirmed)
    useConfirmStore.setState({ request: null })
  }

  return (
    <Dialog
      open={request !== null}
      onClose={() => answer(false)}
      title={request?.title ?? ''}
      description={request?.description}
      size="sm"
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={() => answer(false)}>
            Cancel
          </Button>
          <Button variant="primary" data-testid="confirm-dialog-confirm" onClick={() => answer(true)}>
            {request?.confirmLabel}
          </Button>
        </>
      }
    />
  )
}
