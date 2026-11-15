import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiProduces } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { MetricsService } from "../../observability/metrics.service";

@ApiTags("Observability")
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiOperation({
    summary: "Prometheus & Observability Metrics",
    description:
      "Exports operational metrics: transactions by status, idempotency duplicates, lock conflicts, retries, DLQ counts, outbox lag, and latency percentiles.",
  })
  @ApiProduces("text/plain", "application/json")
  @ApiResponse({ status: 200, description: "Prometheus format or JSON snapshot" })
  public getMetrics(
    @Query("format") format: string | undefined,
    @Req() req: Request,
    @Res() res: Response
  ): void {
    const acceptsJson = req.headers["accept"]?.includes("application/json") || format === "json";

    if (acceptsJson) {
      res.setHeader("Content-Type", "application/json");
      res.status(200).json(this.metricsService.getSnapshot());
      return;
    }

    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.status(200).send(this.metricsService.toPrometheus());
  }
}
