import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Products from "./Products";
import { get } from "../lib/api";

vi.mock("../lib/api", () => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn() }));
let requests;
const reply = (label, page = 1, total = 1) => ({
  items: [{ barcode: `SKU-${label}`, product_name: label, my_price: 500 }],
  total,
  page,
  limit: 50,
});
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function resolve(request, value) {
  await act(async () => {
    request.resolve(value);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  requests = [];
  get.mockReset().mockImplementation(
    (path, options) =>
      new Promise((resolve, reject) => {
        requests.push({ path, signal: options?.signal, resolve, reject });
      }),
  );
});
afterEach(() => {
  vi.useRealTimers();
});
function search(value) {
  fireEvent.change(screen.getByPlaceholderText("Barkod veya ürün ara"), {
    target: { value },
  });
}

test("old unfiltered response cannot replace kahve, even before its debounce starts", async () => {
  render(<Products notify={vi.fn()} />);
  await tick();
  const old = requests[0];
  search("kahve");
  expect(old.signal.aborted).toBe(true);
  await resolve(old, reply("OLD-1521"));
  expect(screen.queryByText("OLD-1521")).not.toBeInTheDocument();
  await tick(300);
  await resolve(requests[1], reply("KAHVE-51"));
  expect(screen.getByText("KAHVE-51")).toBeVisible();
  await tick(10000);
  expect(screen.getByPlaceholderText("Barkod veya ürün ara")).toHaveValue(
    "kahve",
  );
  expect(get).toHaveBeenCalledTimes(2);
});

test("kahve → kahv and rapid typing: late old result/error cannot own results or loading", async () => {
  render(<Products notify={vi.fn()} />);
  await tick();
  search("kahve");
  await tick(300);
  const coffee = requests[1];
  search("kahv");
  search("kah");
  search("kahv");
  await tick(300);
  const latest = requests[2];
  await act(async () => {
    coffee.reject(new Error("OLD ERROR"));
    requests[0].resolve(reply("OLD"));
  });
  expect(screen.queryByText("OLD ERROR")).not.toBeInTheDocument();
  expect(screen.queryByText("OLD")).not.toBeInTheDocument();
  await resolve(latest, reply("LATEST"));
  expect(screen.getByText("LATEST")).toBeVisible();
});

test("the exact old-1521-after-new-51 counterexample preserves the new list", async () => {
  render(<Products notify={vi.fn()} />);
  await tick();
  search("kahve");
  await tick(300);
  await resolve(requests[1], reply("COFFEE-51"));
  await resolve(requests[0], reply("UNFILTERED-1521"));
  expect(screen.getByText("COFFEE-51")).toBeVisible();
  expect(screen.queryByText("UNFILTERED-1521")).not.toBeInTheDocument();
});

for (const [index, value] of [
  [3, "false"],
  [4, "MANUAL"],
])
  test(`automation filter ${index} rejects an earlier scope`, async () => {
    render(<Products notify={vi.fn()} />);
    await tick();
    fireEvent.change(screen.getAllByRole("combobox")[index], {
      target: { value },
    });
    await tick();
    await resolve(requests[1], reply("POLICY"));
    await resolve(requests[0], reply("OLD-POLICY"));
    expect(requests[1].path).toContain(
      index === 3 ? "autoUpdate=false" : "mode=MANUAL",
    );
    expect(screen.queryByText("OLD-POLICY")).not.toBeInTheDocument();
  });

for (const [placeholder, value] of [
  ["Marka", "Harras"],
  ["Kategori adı veya ID", "Kahve"],
])
  test(`${placeholder} change protects combined search parameters`, async () => {
    render(<Products notify={vi.fn()} />);
    await tick();
    search("kahve");
    await tick(300);
    fireEvent.change(screen.getByPlaceholderText(placeholder), {
      target: { value },
    });
    await tick(300);
    await resolve(requests[2], reply("FILTERED"));
    await resolve(requests[1], reply("STALE"));
    expect(requests[2].path).toContain("search=kahve");
    expect(decodeURIComponent(requests[2].path)).toContain(value);
    expect(screen.queryByText("STALE")).not.toBeInTheDocument();
  });

test("automation filter and pagination reset invalidate page 2 immediately", async () => {
  render(<Products notify={vi.fn()} />);
  await tick();
  await resolve(requests[0], reply("PAGE1", 1, 100));
  fireEvent.click(screen.getByRole("button", { name: "Sonraki" }));
  await tick();
  const page2 = requests[1];
  fireEvent.change(screen.getAllByRole("combobox")[0], {
    target: { value: "loss" },
  });
  await tick();
  await resolve(requests[2], reply("RESET"));
  await resolve(page2, reply("PAGE2", 2, 100));
  expect(requests[2].path).toContain("page=1");
  expect(screen.queryByText("PAGE2")).not.toBeInTheDocument();
});

test("marketplace switch and manual refresh share ownership", async () => {
  const view = render(<Products notify={vi.fn()} marketplace="TRENDYOL" />);
  await tick();
  const ty = requests[0];
  view.rerender(<Products notify={vi.fn()} marketplace="HEPSIBURADA" />);
  await tick();
  const hb = requests[1];
  fireEvent.click(screen.getByRole("button", { name: "Yenile" }));
  expect(requests[2].path).toContain("marketplace=HEPSIBURADA");
  await resolve(requests[2], reply("FRESH-HB"));
  await resolve(ty, reply("OLD-TY"));
  await resolve(hb, reply("OLD-HB"));
  expect(screen.queryByText("OLD-TY")).not.toBeInTheDocument();
  expect(screen.queryByText("OLD-HB")).not.toBeInTheDocument();
});

test("unmount aborts the request and late completion has no owner", async () => {
  const view = render(<Products notify={vi.fn()} />);
  await tick();
  view.unmount();
  expect(requests[0].signal.aborted).toBe(true);
  await resolve(requests[0], reply("UNMOUNTED"));
  await tick(10000);
  expect(get).toHaveBeenCalledTimes(1);
});
