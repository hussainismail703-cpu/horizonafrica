import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export async function GET() {
  const wb = XLSX.utils.book_new();

  const data = [
    { "Contact Name": "John Doe", "Phone Number": "+27821234567" },
    { "Contact Name": "Jane Smith", "Phone Number": "+27831234567" },
    { "Contact Name": "Sipho Mthembu", "Phone Number": "+27791234567" },
    { "Contact Name": "", "Phone Number": "+27612345678" },
  ];

  const ws = XLSX.utils.json_to_sheet(data);

  // Set column widths
  ws["!cols"] = [{ wch: 25 }, { wch: 20 }];

  XLSX.utils.book_append_sheet(wb, ws, "Contacts");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="eastern-wear-contacts-template.xlsx"',
    },
  });
}
