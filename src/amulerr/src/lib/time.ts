export function buildRFC822Date(date: Date) {
  const dayStrings = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const monthStrings = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]

  const day = dayStrings[date.getDay()]
  const dayNumber = date.getDate().toString().padStart(2, '0')
  const month = monthStrings[date.getMonth()]
  const year = date.getFullYear()
  const time = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:00`

  // Numeric RFC822/2822 zone (e.g. "+0200", "-0500"), valid for any TZ/DST —
  // the previous GMT/"BST" guess mislabeled every non-UK, non-UTC timezone
  // (e.g. TZ=Europe/Madrid in summer is UTC+2, not +1/"BST"), which would
  // make consumers that take the abbreviation literally compute the wrong
  // instant even though the hour/minute values above were already correct.
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  const offsetHours = Math.floor(absOffset / 60)
    .toString()
    .padStart(2, '0')
  const offsetMins = (absOffset % 60).toString().padStart(2, '0')
  const timezone =
    offsetMinutes === 0 ? 'GMT' : `${sign}${offsetHours}${offsetMins}`

  // Wed, 02 Oct 2002 13:00:00 GMT
  return `${day}, ${dayNumber} ${month} ${year} ${time} ${timezone}`
}
