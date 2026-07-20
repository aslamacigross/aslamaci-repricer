import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ErrorState, Loading, useRemote } from "./ui";

function RemoteHarness({ loader }) {
  const { data, error, loading, reload } = useRemote(loader, []);
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} retry={reload} />;
  return <p>{data.message}</p>;
}

describe("useRemote", () => {
  test("basarili tekrar denemede onceki hatayi temizler", async () => {
    const user = userEvent.setup();
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("İlk istek başarısız"))
      .mockResolvedValueOnce({ message: "Rapor hazır" });

    render(<RemoteHarness loader={loader} />);

    expect(await screen.findByText("İlk istek başarısız")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Tekrar dene" }));

    expect(await screen.findByText("Rapor hazır")).toBeVisible();
    expect(screen.queryByText("İlk istek başarısız")).toBeNull();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
