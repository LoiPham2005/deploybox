/**
 * Logo DeployBox — "mũi tên bay lên từ chiếc hộp mở" (deploy + box).
 * SVG inline: sắc nét mọi kích cỡ, không tốn request. Đổi màu qua props.
 */
export function LogoMark({
  size = 24,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="DeployBox"
    >
      <defs>
        <linearGradient id="db-badge" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366F1" />
          <stop offset="1" stopColor="#4338CA" />
        </linearGradient>
      </defs>
      {/* Huy hiệu nền */}
      <rect width="512" height="512" rx="115" fill="url(#db-badge)" />
      {/* Hộp mở */}
      <path
        d="M150 250 V356 H362 V250"
        stroke="white"
        strokeWidth="42"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Mũi tên deploy bay lên từ trong hộp */}
      <path
        d="M256 322 V150 M196 210 L256 150 L316 210"
        stroke="white"
        strokeWidth="42"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
