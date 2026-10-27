import { vehicleImages } from './resources/vehicle-images'

export async function pickVehicleImage(selectedId = ''): Promise<string | undefined> {
  const table = new UITable()
  table.showSeparators = true
  let selection: string | undefined

  const automatic = new UITableRow()
  automatic.height = 55
  automatic.addText(selectedId ? 'Automatic' : '✓ Automatic', 'Choose from vehicle details')
  automatic.onSelect = () => {
    selection = ''
  }
  table.addRow(automatic)

  for (const image of vehicleImages) {
    const row = new UITableRow()
    row.height = 90
    const preview = UITableCell.imageAtURL(image.url)
    preview.widthWeight = 45
    row.addCell(preview)
    row.addText(`${selectedId === image.id ? '✓ ' : ''}${image.name}`, image.year).widthWeight = 55
    row.onSelect = () => {
      selection = image.id
    }
    table.addRow(row)
  }

  await table.present()
  return selection
}
