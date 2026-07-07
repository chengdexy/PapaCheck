type MascotName = 'wave' | 'bye' | 'thumbs' | 'ok' | 'point';

type MascotProps = {
  name: MascotName;
  alt: string;
  className?: string;
  /** 1x 展示尺寸（px），用于设置 width/height 防 CLS */
  size: number;
  /** 是否首屏 LCP 元素 */
  priority?: boolean;
};

/**
 * 吉祥物图片组件
 * - 默认 <picture> 优先 WebP，PNG 兜底
 * - 默认 loading=lazy；priority=true 时为 eager + fetchPriority=high
 * - 1x / 2x 资源自动切换
 */
export default function Mascot({ name, alt, className, size, priority = false }: MascotProps) {
  const base = `${import.meta.env.BASE_URL}imgs/mascot/mascot-${name}`;
  const loading = priority ? 'eager' : 'lazy';
  return (
    <picture>
      <source
        srcSet={`${base}.webp 1x, ${base}@2x.webp 2x`}
        type="image/webp"
      />
      <img
        src={`${base}.png`}
        alt={alt}
        className={className}
        width={size}
        height={size}
        loading={loading}
        decoding={priority ? 'sync' : 'async'}
        fetchPriority={priority ? 'high' : 'auto'}
      />
    </picture>
  );
}
