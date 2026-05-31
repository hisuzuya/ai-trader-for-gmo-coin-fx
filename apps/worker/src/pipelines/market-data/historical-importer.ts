import { CandleRepository } from "@ai-trade/db";
import {
  type CanonicalCandle,
  GmoFxPublicClient,
  type ImportGmoHistoricalCandlesOptions,
  importGmoHistoricalCandles,
  type MarketSymbol,
} from "@ai-trade/domain/market-data";

export type HistoricalImportRequest = {
  date: string;
};

export type HistoricalImportResult = {
  importedCandles: number;
};

export interface HistoricalImporter {
  importDate(request: HistoricalImportRequest): Promise<HistoricalImportResult>;
}

type HistoricalImporterClient = NonNullable<ImportGmoHistoricalCandlesOptions["client"]>;

type HistoricalCandleRepository = Pick<CandleRepository, "upsertMany">;

export interface GmoHistoricalImporterOptions {
  client?: HistoricalImporterClient;
  repository?: HistoricalCandleRepository;
  symbol?: MarketSymbol;
}

export class GmoHistoricalImporter implements HistoricalImporter {
  private readonly client: HistoricalImporterClient;
  private readonly repository: HistoricalCandleRepository;
  private readonly symbol: MarketSymbol;

  constructor(options: GmoHistoricalImporterOptions = {}) {
    this.client = options.client ?? new GmoFxPublicClient();
    this.repository = options.repository ?? new CandleRepository();
    this.symbol = options.symbol ?? "USD_JPY";
  }

  async importDate(request: HistoricalImportRequest): Promise<HistoricalImportResult> {
    const result = await importGmoHistoricalCandles({
      client: this.client,
      writer: {
        writeCandles: (candles: CanonicalCandle[]) => this.repository.upsertMany(candles),
      },
      symbol: this.symbol,
      targetDate: request.date,
    });

    return {
      importedCandles: result.plannedCandleCount,
    };
  }
}

export class StubHistoricalImporter implements HistoricalImporter {
  async importDate(): Promise<HistoricalImportResult> {
    return {
      importedCandles: 0,
    };
  }
}
