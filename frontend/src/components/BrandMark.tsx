/**
 * The Astra star mark: the app's only gradient (DESIGN_LANGUAGE.md §6), used in the header
 * and as the agent avatar in transcripts.
 */
export function BrandMark({ size = 24 }: { size?: number }) {
  const iconSize = Math.round(size * 0.625);
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(140deg, var(--astra-primary), var(--astra-accent))',
      }}
    >
      <svg viewBox="0 0 32 32" width={iconSize} height={iconSize}>
        <path d="M16 4l3.1 8.9L28 16l-8.9 3.1L16 28l-3.1-8.9L4 16l8.9-3.1z" fill="var(--astra-primary-ink)" />
      </svg>
    </span>
  );
}
