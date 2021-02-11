/* 
TabMerger as the name implies merges your tabs into one location to save
memory usage and increase your productivity.

Copyright (C) 2021  Lior Bragilevsky

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

If you have any questions, comments, or concerns you can contact the
TabMerger team at <https://lbragile.github.io/TabMerger-Extension/contact/>
*/

import { getFavIconURL } from "../../src/components/Tab/Tab_helpers";

describe("getFavIconURL", () => {
  const base = "http://www.google.com/s2/favicons?domain=";
  it("returns the API call with just domain name", () => {
    var url = "https://www.google.com/";
    var domain = "www.google.com";
    expect(getFavIconURL(url)).toBe(base + domain);

    url = "http://www.google.com/";
    expect(getFavIconURL(url)).toBe(base + domain);

    url = "http://www.google.com";
    expect(getFavIconURL(url)).toBe(base + domain);
  });

  it("return null if pattern doesn't match", () => {
    var url = "chrome://www.google.com/";
    expect(getFavIconURL(url)).toBe(base + null);

    url = "xhttp://www.google.com/";
    expect(getFavIconURL(url)).toBe(base + null);
  });
});
