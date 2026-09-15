'use client';

import { Popover } from '@base-ui/react/popover';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function CommentPopover({
  pinId,
  title,
  onClose,
  children,
}: {
  pinId: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Popover.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          anchor={() => document.getElementById(`comment-pin-${pinId}`)}
          positionMethod="fixed"
          side="bottom"
          align="start"
          sideOffset={12}
          collisionPadding={12}
          className="comment-positioner"
        >
          <Popover.Popup
            className="point-comment"
            aria-label={title}
            initialFocus={() =>
              document.getElementById('point-comment-body') ?? true
            }
            finalFocus={() =>
              document.getElementById(`comment-pin-${pinId}`) ??
              document.getElementById('artifact-preview')
            }
          >
            <Popover.Title className="sr-only">{title}</Popover.Title>
            <Popover.Close
              className="point-comment-close"
              aria-label="Close comment"
            >
              <X size={16} />
            </Popover.Close>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
