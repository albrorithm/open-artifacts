'use client';

import { useLayoutEffect, useRef, type ComponentProps } from 'react';

function fitComment(input: HTMLTextAreaElement) {
  const style = getComputedStyle(input);
  const line = parseFloat(style.lineHeight);
  const inset =
    parseFloat(style.paddingTop) +
    parseFloat(style.paddingBottom) +
    parseFloat(style.borderTopWidth) +
    parseFloat(style.borderBottomWidth);
  const border =
    parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  const maximum = line * 5 + inset;
  const scrollTop = input.scrollTop;
  input.style.height = 'auto';
  input.style.overflowY = 'hidden';
  const content = input.value ? input.scrollHeight + border : line + inset;
  input.style.height = `${Math.max(line + inset, Math.min(content, maximum))}px`;
  input.style.overflowY = content > maximum ? 'auto' : 'hidden';
  input.scrollTop =
    document.activeElement === input &&
    input.selectionEnd === input.value.length
      ? input.scrollHeight
      : scrollTop;
}

export function CommentInput({
  value,
  ...props
}: Omit<ComponentProps<'textarea'>, 'ref' | 'rows' | 'value'> & {
  value: string;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (input.current) fitComment(input.current);
  }, [value]);
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      fitComment(node);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <textarea {...props} ref={input} rows={1} value={value} />;
}
