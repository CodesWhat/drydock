export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const serializedData = JSON.stringify(data).replace(/</g, "\\u003c");

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializedData }} />;
}
