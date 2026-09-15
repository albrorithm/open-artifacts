import type { ReviewTarget } from '@/lib/artifacts/review-target';

function elementName(tag: string) {
  if (/^h[1-6]$/.test(tag)) return 'Heading';
  return (
    {
      p: 'Paragraph',
      a: 'Link',
      button: 'Button',
      input: 'Input',
      textarea: 'Text field',
      select: 'Select field',
      label: 'Label',
      img: 'Image',
      svg: 'Graphic',
      canvas: 'Canvas',
      li: 'List item',
      blockquote: 'Quotation',
      section: 'Section',
      article: 'Article',
      figure: 'Figure',
      figcaption: 'Caption',
      td: 'Table cell',
      th: 'Table heading',
    }[tag] ?? 'Element'
  );
}

export function TargetContext({
  target,
  section,
  excerpt,
  compact = false,
}: {
  target: ReviewTarget | null;
  section: string;
  excerpt: string;
  compact?: boolean;
}) {
  if (!target && !compact) {
    return excerpt ? (
      <details className="comment-context">
        <summary>Context</summary>
        <blockquote>{excerpt}</blockquote>
      </details>
    ) : null;
  }

  const element = target?.element;
  const area = target?.kind === 'area' ? target.area : null;
  const isText = target?.kind === 'text';
  const isPoint = !target || target.kind === 'point';
  const kind = area
    ? 'Selected area'
    : isText
      ? 'Exact text selection'
      : isPoint
        ? 'Point'
        : elementName(element?.tag ?? '');
  const quote = area
    ? undefined
    : isText
      ? target?.text?.exact
      : isPoint
        ? excerpt
        : element?.text;
  const label = element?.label;
  const locator = element?.cssPath;

  if (compact) {
    return (
      <p
        className="comment-target-summary"
        aria-label="Selected comment target"
      >
        {area ? 'Selected area' : section || label || kind}
      </p>
    );
  }

  return (
    <section className="comment-target" aria-label="Comment target">
      <p className="comment-target-kind">
        <span>Target</span>
        <strong>{kind}</strong>
      </p>
      {section && <p className="comment-target-section">In {section}</p>}
      {!area && label && label !== quote && (
        <p className="comment-target-label">{label}</p>
      )}
      {quote && (
        <blockquote className={isText ? 'comment-target-exact' : undefined}>
          {quote}
        </blockquote>
      )}
      {!area && !quote && !label && !isPoint && (
        <p className="comment-target-section">
          This element has no text label.
        </p>
      )}
      {isText && quote && (
        <p className="comment-target-section">
          Full selection · {Array.from(quote).length} characters
        </p>
      )}
      {area && (
        <div className="comment-target-area">
          {area.members.length > 0 ? (
            <>
              <p className="comment-target-section">
                {area.members.length} captured{' '}
                {area.members.length === 1 ? 'element' : 'elements'}
              </p>
              <ol className="comment-target-members">
                {area.members.map((member, index) => (
                  <li key={`${member.element.path}-${index}`}>
                    <p className="comment-target-member-heading">
                      <strong>{elementName(member.element.tag)}</strong>
                      {member.coverage === 'partial' && (
                        <span>Partly covered</span>
                      )}
                    </p>
                    {member.element.label &&
                      member.element.label !== member.element.text && (
                        <p className="comment-target-label">
                          {member.element.label}
                        </p>
                      )}
                    {member.element.text ? (
                      <blockquote>{member.element.text}</blockquote>
                    ) : !member.element.label ? (
                      <p className="comment-target-section">
                        No readable text or label.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="comment-target-section">
              No readable elements were captured in this area.
            </p>
          )}
          {area.truncated && (
            <p className="comment-target-section">
              The captured context is partial; this area contains more content.
            </p>
          )}
        </div>
      )}
      {locator && (
        <details className="comment-target-locator">
          <summary>
            {isText || area ? 'Containing element' : 'Element details'}
          </summary>
          <code>{`<${element.tag}>`}</code>
          <code>{locator}</code>
        </details>
      )}
    </section>
  );
}
