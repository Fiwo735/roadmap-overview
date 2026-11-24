import { ImageOff } from 'lucide-react'
import { usePhotoUrl, type PhotoKind } from './photoUrls'
import './photos.css'

interface PhotoImageProps {
  id: string
  kind: PhotoKind
  alt: string
  className?: string
}

/** A stored photo as an image; a photo this browser does not have (any more) shows a quiet placeholder. */
export function PhotoImage({ id, kind, alt, className }: PhotoImageProps) {
  const photo = usePhotoUrl(id, kind)
  const classes = (extra: string) => ['photo-img', extra, className].filter(Boolean).join(' ')
  if (photo.status === 'ready') return <img className={classes('')} src={photo.url} alt={alt} draggable={false} />
  if (photo.status === 'missing') {
    return (
      <span className={classes('photo-img--missing')} role="img" aria-label="Photo not available" title="This photo is not stored in this browser">
        <ImageOff size={18} aria-hidden="true" />
      </span>
    )
  }
  return <span className={classes('photo-img--loading')} aria-hidden="true" />
}
