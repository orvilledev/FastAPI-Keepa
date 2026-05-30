type TotpQrCodeProps = {
  qrCode?: string | null
  uri?: string | null
}

/** Renders Supabase TOTP enrollment QR (SVG, data URL, or otpauth URI). */
export default function TotpQrCode({ qrCode, uri }: TotpQrCodeProps) {
  const trimmed = qrCode?.trim() ?? ''
  if (trimmed.startsWith('data:image')) {
    return (
      <img
        src={trimmed}
        alt="Scan with your authenticator app"
        className="mx-auto h-48 w-48 rounded-md"
      />
    )
  }

  if (trimmed.includes('<svg')) {
    return (
      <div
        className="mx-auto flex items-center justify-center [&_svg]:h-48 [&_svg]:w-48"
        dangerouslySetInnerHTML={{ __html: trimmed }}
      />
    )
  }

  if (uri) {
    return (
      <img
        src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(uri)}`}
        alt="Scan with your authenticator app"
        className="mx-auto h-48 w-48 rounded-md border border-gray-100"
      />
    )
  }

  return (
    <p className="text-center text-sm text-gray-500">
      QR code could not be loaded. Use the manual entry key below.
    </p>
  )
}
