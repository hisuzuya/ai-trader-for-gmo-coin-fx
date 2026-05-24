export type HistoricalImportRequest = {
  date: string;
};

export type HistoricalImportResult = {
  importedCandles: number;
};

export interface HistoricalImporter {
  importDate(
    request: HistoricalImportRequest,
  ): Promise<HistoricalImportResult>;
}

export class StubHistoricalImporter implements HistoricalImporter {
  async importDate(): Promise<HistoricalImportResult> {
    return {
      importedCandles: 0,
    };
  }
}
